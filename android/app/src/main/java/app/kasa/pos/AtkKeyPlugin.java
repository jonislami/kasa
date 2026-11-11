package app.kasa.pos;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.spec.ECGenParameterSpec;
import java.util.regex.Pattern;

/**
 * ATK signing key of the till (fiscalization) in the Android Keystore.
 * ECDSA P-256 is generated inside the Keystore (hardware-backed where the phone has it); the private
 * key can never be read out – the app only gets the public key (SPKI) and signatures.
 * Signatures are returned as raw r||s (64 bytes, base64), the same format WebCrypto uses.
 */
@CapacitorPlugin(name = "AtkKey")
public class AtkKeyPlugin extends Plugin {
    private static final String STORE = "AndroidKeyStore";
    private static final Pattern ALIAS = Pattern.compile("^atk:[0-9a-fA-F-]{36}$");

    private static KeyStore keyStore() throws Exception {
        KeyStore ks = KeyStore.getInstance(STORE);
        ks.load(null);
        return ks;
    }

    private static String alias(PluginCall call) {
        String a = call.getString("alias");
        if (a == null || !ALIAS.matcher(a).matches()) {
            call.reject("Emër i pavlefshëm i çelësit");
            return null;
        }
        return a;
    }

    private static String publicKey(KeyStore ks, String alias) throws Exception {
        Certificate cert = ks.getCertificate(alias);
        return cert == null ? null : Base64.encodeToString(cert.getPublicKey().getEncoded(), Base64.NO_WRAP);
    }

    @PluginMethod
    public void ensureKey(PluginCall call) {
        String a = alias(call);
        if (a == null) return;
        try {
            KeyStore ks = keyStore();
            if (!ks.containsAlias(a)) {
                KeyPairGenerator gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, STORE);
                gen.initialize(new KeyGenParameterSpec.Builder(a, KeyProperties.PURPOSE_SIGN)
                        .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                        .setDigests(KeyProperties.DIGEST_SHA256)
                        .build());
                gen.generateKeyPair();
            }
            JSObject r = new JSObject();
            r.put("publicKey", publicKey(ks, a));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Çelësi i arkës nuk u krijua: " + e.getMessage());
        }
    }

    @PluginMethod
    public void hasKey(PluginCall call) {
        String a = alias(call);
        if (a == null) return;
        try {
            JSObject r = new JSObject();
            r.put("value", keyStore().containsAlias(a));
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void getPublicKey(PluginCall call) {
        String a = alias(call);
        if (a == null) return;
        try {
            KeyStore ks = keyStore();
            JSObject r = new JSObject();
            r.put("publicKey", ks.containsAlias(a) ? publicKey(ks, a) : null);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void sign(PluginCall call) {
        String a = alias(call);
        if (a == null) return;
        String data = call.getString("data");
        if (data == null) {
            call.reject("Të dhëna të pavlefshme");
            return;
        }
        try {
            KeyStore ks = keyStore();
            PrivateKey key = (PrivateKey) ks.getKey(a, null);
            if (key == null) {
                call.reject("Çelësi i arkës nuk ekziston në këtë pajisje");
                return;
            }
            Signature s = Signature.getInstance("SHA256withECDSA");
            s.initSign(key);
            s.update(Base64.decode(data, Base64.NO_WRAP));
            JSObject r = new JSObject();
            r.put("signature", Base64.encodeToString(derToRaw(s.sign()), Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Nënshkrimi dështoi: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        String a = alias(call);
        if (a == null) return;
        try {
            KeyStore ks = keyStore();
            if (ks.containsAlias(a)) ks.deleteEntry(a);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** DER SEQUENCE { INTEGER r, INTEGER s } → r||s, each left-padded to 32 bytes. */
    static byte[] derToRaw(byte[] der) {
        int i = 0;
        if (der[i++] != 0x30) throw new IllegalArgumentException("not a DER sequence");
        int len = der[i++] & 0xff;
        if (len == 0x81) i++; // long form (never for P-256, kept for safety)
        byte[] out = new byte[64];
        for (int part = 0; part < 2; part++) {
            if (der[i++] != 0x02) throw new IllegalArgumentException("not a DER integer");
            int n = der[i++] & 0xff;
            int start = i;
            int count = n;
            while (count > 32 && der[start] == 0) { // drop the sign byte
                start++;
                count--;
            }
            if (count > 32) throw new IllegalArgumentException("integer too long");
            System.arraycopy(der, start, out, part * 32 + (32 - count), count);
            i += n;
        }
        return out;
    }
}
