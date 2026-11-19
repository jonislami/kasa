package app.kasa.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Thermal receipt printers over classic Bluetooth (SPP / RFCOMM) – most 58 / 80 mm printers (Xprinter, MTP, "POS-58")
 * speak only this, not Bluetooth Low Energy. The printer is paired once in the phone's Bluetooth settings; the app
 * lists the paired devices, connects to one and writes ESC/POS bytes to it. One connection at a time; all socket work
 * runs on one background thread so the bytes of a receipt keep their order.
 */
@CapacitorPlugin(
    name = "KasaPrinter",
    permissions = { @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }) }
)
public class KasaPrinterPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private BluetoothSocket socket;
    private OutputStream out;
    private String connectedAddress;
    private String connectedName;

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    /** Android 12+ asks for "Nearby devices" once; older versions grant Bluetooth at install. */
    private boolean allowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean ensurePermission(PluginCall call, String callback) {
        if (allowed()) return true;
        requestPermissionForAlias("bluetooth", call, callback);
        return false;
    }

    private boolean ready(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) {
            call.reject("Kjo pajisje nuk ka Bluetooth", "NO_BLUETOOTH");
            return false;
        }
        if (!a.isEnabled()) {
            call.reject("Ndize Bluetooth-in e pajisjes", "BLUETOOTH_OFF");
            return false;
        }
        return true;
    }

    @PluginMethod
    public void paired(PluginCall call) {
        if (!ensurePermission(call, "pairedAfterPermission")) return;
        listPaired(call);
    }

    @PermissionCallback
    private void pairedAfterPermission(PluginCall call) {
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            call.reject("Lejo “Pajisjet afër” (Bluetooth) për KontoSef te cilësimet e telefonit", "PERMISSION_DENIED");
            return;
        }
        listPaired(call);
    }

    @SuppressWarnings("MissingPermission")
    private void listPaired(PluginCall call) {
        if (!ready(call)) return;
        JSArray list = new JSArray();
        try {
            Set<BluetoothDevice> bonded = adapter().getBondedDevices();
            for (BluetoothDevice d : bonded) {
                int type = d.getType();
                if (type == BluetoothDevice.DEVICE_TYPE_LE) continue; // BLE-only devices go through the BLE plugin
                BluetoothClass c = d.getBluetoothClass();
                int major = c == null ? 0 : c.getMajorDeviceClass();
                JSObject o = new JSObject();
                o.put("id", d.getAddress());
                o.put("name", d.getName() == null ? d.getAddress() : d.getName());
                // printers report "imaging" (0x0600) or "uncategorized"; phones, headsets and cars are listed last
                o.put("printer", major == BluetoothClass.Device.Major.IMAGING || major == BluetoothClass.Device.Major.UNCATEGORIZED);
                list.put(o);
            }
        } catch (SecurityException e) {
            call.reject("Lejo “Pajisjet afër” (Bluetooth) për KontoSef", "PERMISSION_DENIED");
            return;
        }
        JSObject r = new JSObject();
        r.put("devices", list);
        call.resolve(r);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (!ensurePermission(call, "connectAfterPermission")) return;
        doConnect(call);
    }

    @PermissionCallback
    private void connectAfterPermission(PluginCall call) {
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            call.reject("Lejo “Pajisjet afër” (Bluetooth) për KontoSef", "PERMISSION_DENIED");
            return;
        }
        doConnect(call);
    }

    @SuppressWarnings("MissingPermission")
    private void doConnect(PluginCall call) {
        if (!ready(call)) return;
        String address = call.getString("id");
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("Printeri nuk u gjet", "NOT_FOUND");
            return;
        }
        io.execute(() -> {
            closeQuietly();
            BluetoothAdapter a = adapter();
            try {
                a.cancelDiscovery();
                BluetoothDevice d = a.getRemoteDevice(address);
                BluetoothSocket s = open(d);
                socket = s;
                out = s.getOutputStream();
                connectedAddress = address;
                connectedName = d.getName() == null ? address : d.getName();
                JSObject r = new JSObject();
                r.put("name", connectedName);
                call.resolve(r);
            } catch (SecurityException e) {
                call.reject("Lejo “Pajisjet afër” (Bluetooth) për KontoSef", "PERMISSION_DENIED");
            } catch (Exception e) {
                closeQuietly();
                call.reject("Printeri nuk u lidh. Kontrollo që është i ndezur, afër dhe i çiftuar.", "CONNECT_FAILED");
            }
        });
    }

    /** Secure RFCOMM first, then insecure, then channel 1 – cheap printers differ in what they accept. */
    @SuppressWarnings("MissingPermission")
    private BluetoothSocket open(BluetoothDevice d) throws Exception {
        IOException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            BluetoothSocket s = null;
            try {
                if (attempt == 0) s = d.createRfcommSocketToServiceRecord(SPP);
                else if (attempt == 1) s = d.createInsecureRfcommSocketToServiceRecord(SPP);
                else {
                    Method m = d.getClass().getMethod("createRfcommSocket", int.class);
                    s = (BluetoothSocket) m.invoke(d, 1);
                }
                s.connect();
                return s;
            } catch (IOException e) {
                last = e;
                if (s != null) try { s.close(); } catch (IOException ignored) { }
            }
        }
        throw last == null ? new IOException("connect failed") : last;
    }

    @PluginMethod
    public void write(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Asgjë për të printuar");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        io.execute(() -> {
            if (out == null) {
                call.reject("Printeri nuk është i lidhur", "NOT_CONNECTED");
                return;
            }
            try {
                // small pieces with a short pause: cheap printers have a small buffer and drop bytes otherwise
                for (int i = 0; i < bytes.length; i += 512) {
                    out.write(bytes, i, Math.min(512, bytes.length - i));
                    out.flush();
                    if (bytes.length > 512) Thread.sleep(15);
                }
                call.resolve();
            } catch (Exception e) {
                closeQuietly();
                call.reject("Lidhja me printerin u ndërpre. Lidhe përsëri.", "WRITE_FAILED");
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        io.execute(() -> {
            closeQuietly();
            call.resolve();
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("connected", socket != null && socket.isConnected());
        r.put("id", connectedAddress);
        r.put("name", connectedName);
        call.resolve(r);
    }

    /** A network printer (Ethernet / Wi-Fi): ESC/POS to host:port (usually 9100), on its own thread. */
    @PluginMethod
    public void sendTcp(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        String data = call.getString("data");
        if (host == null || host.isEmpty() || port == null || port < 1 || port > 65535 || data == null) {
            call.reject("Adresa e printerit nuk është e saktë");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        net.execute(() -> {
            try (java.net.Socket s = new java.net.Socket()) {
                s.connect(new java.net.InetSocketAddress(host, port), 6000);
                s.setSoTimeout(6000);
                OutputStream o = s.getOutputStream();
                o.write(bytes);
                o.flush();
                call.resolve();
            } catch (Exception e) {
                call.reject("Printeri " + host + ":" + port + " nuk përgjigjet", "NETWORK_FAILED");
            }
        });
    }

    /** Opens the phone's Bluetooth settings, where a new printer is paired (PIN usually 0000 or 1234). */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    private void closeQuietly() {
        try {
            if (out != null) out.close();
        } catch (IOException ignored) {
        }
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
        out = null;
        socket = null;
        connectedAddress = null;
        connectedName = null;
    }

    @Override
    protected void handleOnDestroy() {
        io.execute(this::closeQuietly);
        io.shutdown();
        net.shutdown();
    }
}
