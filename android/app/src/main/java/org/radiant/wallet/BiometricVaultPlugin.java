package org.radiant.wallet;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.UnrecoverableKeyException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Hardware-backed biometric unlock.
 *
 * The wallet secret (the full encrypted-vault payload: mnemonic + network +
 * settings, JSON) is encrypted with an AES-256-GCM key that lives in the
 * AndroidKeyStore and is created with:
 *
 *   setUserAuthenticationRequired(true)
 *   setInvalidatedByBiometricEnrollment(true)   // adding a new fingerprint wipes it
 *
 * The key material never leaves the TEE/StrongBox. Decryption is only possible
 * after a successful BIOMETRIC_STRONG authentication, and the cipher is bound to
 * the prompt via a BiometricPrompt.CryptoObject so authentication and decryption
 * cannot be separated.
 *
 * Key lifecycle: a Keystore key invalidated by a biometric / screen-lock change
 * still exists under its alias, so containsAlias() happily reports a dead
 * enrolment as healthy. Every entry point therefore probes the key before use
 * and, when it can no longer be used, drops the key and the ciphertext bound to
 * it so the user is offered a fresh enrolment instead of an unlock that can only
 * ever fail. See {@link #keyState(String)}.
 *
 * Failure policy: everything here is best-effort. Any error is reported to JS as
 * a rejection so the UI can fall back to the passphrase. Biometric unlock must
 * never be the only way into a wallet.
 */
@CapacitorPlugin(name = "BiometricVault")
public class BiometricVaultPlugin extends Plugin {

    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String PREFS = "rxd_biometric_vault";
    private static final int GCM_TAG_BITS = 128;
    private static final String TAG = "BiometricVault";

    /** Result of probing the Keystore for a usable key. */
    private static final int KEY_OK = 0;
    private static final int KEY_MISSING = 1;
    /** Permanently invalidated: the key exists but can never be used again. */
    private static final int KEY_INVALIDATED = 2;
    /** Present but not probeable right now (transient Keystore failure). */
    private static final int KEY_UNUSABLE = 3;

    private PluginCall pendingCall;
    private String pendingAlias;
    private byte[] pendingCiphertext;
    private boolean pendingEncrypt;
    private String pendingPlaintext;
    private BiometricPrompt activePrompt;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private KeyStore keystore() throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        return ks;
    }

    /** Drop both the Keystore key and the ciphertext that was bound to it. */
    private void purge(String alias) {
        if (alias == null) return;
        try {
            KeyStore ks = keystore();
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
        } catch (Exception e) {
            Log.w(TAG, "Could not delete the biometric key", e);
        }
        prefs()
                .edit()
                .remove(alias + ".iv")
                .remove(alias + ".ct")
                .remove(alias + ".label")
                .commit();
    }

    /** Message shown when the Keystore key was invalidated by a biometric change. */
    private static final String INVALIDATED_MESSAGE =
            "Your device biometrics changed, so the stored key is no longer valid. "
                    + "Re-enable biometric unlock in Settings, or use your passphrase.";

    /**
     * Probe the Keystore without prompting the user.
     *
     * A per-use-authentication key is authorised at Cipher.init() time, so an
     * init() that succeeds proves the key is still usable. An invalidated key
     * throws KeyPermanentlyInvalidatedException here (some Android versions wrap
     * it in UnrecoverableKeyException), which is exactly the signal we need -
     * and it costs nothing: a discarded Cipher operation has no side effects.
     */
    private int keyState(String alias) {
        if (alias == null) return KEY_MISSING;
        try {
            KeyStore ks = keystore();
            if (!ks.containsAlias(alias)) return KEY_MISSING;
            SecretKey key = (SecretKey) ks.getKey(alias, null);
            if (key == null) return KEY_MISSING;
            Cipher probe = Cipher.getInstance(TRANSFORMATION);
            probe.init(Cipher.ENCRYPT_MODE, key);
            return KEY_OK;
        } catch (KeyPermanentlyInvalidatedException e) {
            return KEY_INVALIDATED;
        } catch (UnrecoverableKeyException e) {
            return e.getCause() instanceof KeyPermanentlyInvalidatedException
                    ? KEY_INVALIDATED
                    : KEY_UNUSABLE;
        } catch (Exception e) {
            Log.w(TAG, "Keystore probe failed", e);
            return KEY_UNUSABLE;
        }
    }

    private static String describe(int code) {
        switch (code) {
            case BiometricManager.BIOMETRIC_SUCCESS:
                return "";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                return "This device has no biometric hardware";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                return "Biometric hardware is currently unavailable";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                return "No strong biometric is enrolled. Add a fingerprint (or a secure face) in system settings";
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED:
                return "A security update is required before biometrics can be used";
            default:
                return "Biometric authentication is unavailable";
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        int result = BiometricManager.from(getContext())
                .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        boolean available = result == BiometricManager.BIOMETRIC_SUCCESS;
        JSObject ret = new JSObject();
        ret.put("available", available);
        ret.put("reason", available ? "" : describe(result));
        call.resolve(ret);
    }

    @PluginMethod
    public void isEnrolled(PluginCall call) {
        String alias = call.getString("alias");
        boolean hasBlob = alias != null
                && prefs().contains(alias + ".ct")
                && prefs().contains(alias + ".iv");
        int state = keyState(alias);

        // A key invalidated by a biometric change (or by the user removing the
        // screen lock) still exists under its alias. Reporting that as enrolled
        // leaves the user with an unlock button that can only fail and a settings
        // toggle that only offers "Disable". Report it and clean up instead, so
        // the normal enrolment path is available again.
        boolean invalidated = hasBlob && state == KEY_INVALIDATED;
        if (invalidated) purge(alias);

        JSObject ret = new JSObject();
        ret.put("enrolled", hasBlob && state == KEY_OK);
        ret.put("invalidated", invalidated);
        call.resolve(ret);
    }

    @PluginMethod
    public void enroll(PluginCall call) {
        String alias = call.getString("alias");
        String secret = call.getString("secret");
        if (alias == null || alias.isEmpty() || secret == null || secret.isEmpty()) {
            call.reject("alias and secret are required");
            return;
        }
        // A previous prompt may have been abandoned (activity recreated, WebView
        // reloaded). Clear it rather than refusing every later request forever.
        cancelInFlight("Superseded by a new biometric enrolment");
        try {
            SecretKey key = getOrCreateKey(alias);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key);

            pendingCall = call;
            pendingAlias = alias;
            pendingEncrypt = true;
            pendingPlaintext = secret;
            pendingCiphertext = null;

            showPrompt(cipher, "Enable biometric unlock", "Confirm to protect this wallet");
        } catch (Exception e) {
            clearPending();
            call.reject("Could not start biometric enrolment: " + e.getMessage());
        }
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String alias = call.getString("alias");
        if (alias == null || alias.isEmpty()) {
            call.reject("alias is required");
            return;
        }
        String ivB64 = prefs().getString(alias + ".iv", null);
        String ctB64 = prefs().getString(alias + ".ct", null);
        if (ivB64 == null || ctB64 == null) {
            call.reject("Biometric unlock is not set up on this device");
            return;
        }

        int state = keyState(alias);
        if (state == KEY_INVALIDATED) {
            purge(alias);
            call.reject(INVALIDATED_MESSAGE);
            return;
        }
        if (state != KEY_OK) {
            call.reject("The biometric key is unavailable; re-enable it in settings");
            return;
        }

        cancelInFlight("Superseded by a new biometric unlock");
        try {
            byte[] iv = Base64.decode(ivB64, Base64.NO_WRAP);
            byte[] ct = Base64.decode(ctB64, Base64.NO_WRAP);

            KeyStore ks = keystore();
            SecretKey key = (SecretKey) ks.getKey(alias, null);
            if (key == null) {
                call.reject("The biometric key is unavailable; re-enable it in settings");
                return;
            }

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));

            pendingCall = call;
            pendingAlias = alias;
            pendingEncrypt = false;
            pendingPlaintext = null;
            pendingCiphertext = ct;

            showPrompt(cipher, "Unlock wallet", "Confirm your identity to unlock");
        } catch (Exception e) {
            clearPending();
            call.reject("Could not start biometric unlock: " + e.getMessage());
        }
    }

    /** Abandon any open prompt; the JS side calls this when the screen goes away. */
    @PluginMethod
    public void cancel(PluginCall call) {
        cancelInFlight("Authentication cancelled");
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        String alias = call.getString("alias");
        cancelInFlight("Biometric unlock was disabled");
        if (alias != null) purge(alias);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /**
     * Reject and cancel whatever is in flight.
     *
     * Clearing the pending state BEFORE cancelling is deliberate: the prompt's
     * own onAuthenticationError callback then finds nothing to reject, so a
     * caller is never resolved twice (and never left hanging).
     */
    private void cancelInFlight(String reason) {
        PluginCall call = pendingCall;
        BiometricPrompt prompt = activePrompt;
        clearPending();
        if (prompt != null) {
            Runnable cancel = () -> {
                try {
                    prompt.cancelAuthentication();
                } catch (Exception ignored) {
                    // Already gone.
                }
            };
            Activity activity = getActivity();
            if (activity != null) {
                activity.runOnUiThread(cancel);
            } else {
                cancel.run();
            }
        }
        if (call != null) call.reject(reason);
    }

    private void showPrompt(Cipher cipher, String title, String subtitle) {
        if (!(getActivity() instanceof FragmentActivity)) {
            failPending("No foreground activity to show the biometric prompt in");
            return;
        }
        final FragmentActivity activity = (FragmentActivity) getActivity();

        activity.runOnUiThread(() -> {
            try {
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                        .setNegativeButtonText("Use passphrase")
                        .setConfirmationRequired(true)
                        .build();

                BiometricPrompt prompt = new BiometricPrompt(
                        activity,
                        ContextCompat.getMainExecutor(activity),
                        new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(
                                    @NonNull BiometricPrompt.AuthenticationResult result) {
                                Cipher used = cipher;
                                if (result.getCryptoObject() != null
                                        && result.getCryptoObject().getCipher() != null) {
                                    used = result.getCryptoObject().getCipher();
                                }
                                completeWith(used);
                            }

                            @Override
                            public void onAuthenticationError(int errorCode,
                                                              @NonNull CharSequence errString) {
                                failPending(errString == null || errString.length() == 0
                                        ? "Authentication cancelled"
                                        : errString.toString());
                            }

                            @Override
                            public void onAuthenticationFailed() {
                                // One non-matching attempt: leave the prompt open.
                            }
                        });

                activePrompt = prompt;
                // Signature is authenticate(PromptInfo, CryptoObject) - the
                // cipher MUST be bound to the prompt this way, otherwise the
                // decryption could be performed without the user's biometric.
                prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
            } catch (Exception e) {
                failPending("Biometric prompt failed: " + e.getMessage());
            }
        });
    }

    private void completeWith(Cipher cipher) {
        PluginCall call = pendingCall;
        String alias = pendingAlias;
        boolean encrypting = pendingEncrypt;
        String plaintext = pendingPlaintext;
        byte[] ciphertext = pendingCiphertext;
        clearPending();
        try {
            if (encrypting) {
                byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
                byte[] iv = cipher.getIV();
                if (iv == null) throw new IllegalStateException("Cipher produced no IV");
                // commit(), not apply(): the enrolment has to be on disk before the
                // call resolves. With apply() a prompt followed by the OS killing the
                // process leaves the UI telling the user biometrics are on when
                // nothing was ever stored.
                boolean stored = prefs()
                        .edit()
                        .putString(alias + ".iv", Base64.encodeToString(iv, Base64.NO_WRAP))
                        .putString(alias + ".ct", Base64.encodeToString(ct, Base64.NO_WRAP))
                        .commit();
                if (!stored) throw new IllegalStateException("Could not persist the encrypted secret");
                JSObject ret = new JSObject();
                ret.put("ok", true);
                if (call != null) call.resolve(ret);
            } else {
                byte[] plain = cipher.doFinal(ciphertext);
                JSObject ret = new JSObject();
                ret.put("secret", new String(plain, StandardCharsets.UTF_8));
                if (call != null) call.resolve(ret);
            }
        } catch (Exception e) {
            // An invalidated key surfaces here as KeyPermanentlyInvalidatedException
            // (or as a GCM tag failure once the key has been replaced). Either way
            // the stored ciphertext can never be opened again, so drop it.
            if (e instanceof KeyPermanentlyInvalidatedException) purge(alias);
            if (call != null) call.reject("Biometric cryptography failed: " + e.getMessage());
        }
    }

    private void failPending(String message) {
        PluginCall call = pendingCall;
        clearPending();
        if (call != null) call.reject(message);
    }

    private void clearPending() {
        pendingCall = null;
        pendingAlias = null;
        pendingCiphertext = null;
        pendingPlaintext = null;
        pendingEncrypt = false;
        activePrompt = null;
    }

    /**
     * Return a usable key, creating one when needed.
     *
     * A key that exists but can no longer be used (invalidated by a biometric or
     * screen-lock change) is deleted and replaced - otherwise every future
     * enrolment would fail with "Could not start biometric enrolment" and the
     * only way out would be a reinstall.
     */
    private SecretKey getOrCreateKey(String alias) throws Exception {
        KeyStore ks = keystore();
        if (ks.containsAlias(alias)) {
            SecretKey existing = null;
            try {
                existing = (SecretKey) ks.getKey(alias, null);
                if (existing != null) {
                    Cipher probe = Cipher.getInstance(TRANSFORMATION);
                    probe.init(Cipher.ENCRYPT_MODE, existing);
                    return existing;
                }
            } catch (Exception e) {
                Log.w(TAG, "Discarding an unusable biometric key", e);
            }
            purge(alias);
        }

        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);

        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                // Enrolling a new biometric invalidates the key, so a fingerprint
                // added later to the device cannot unwrap the wallet.
                .setInvalidatedByBiometricEnrollment(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Per-use authentication (timeout 0), strong biometrics only.
            builder.setUserAuthenticationParameters(
                    0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }

        generator.init(builder.build());
        return generator.generateKey();
    }

    /**
     * If the activity is destroyed with a prompt open (process death, a WebView
     * reload, an OEM that recreates on rotation) the JS promise would otherwise
     * never settle: the unlock screen would sit on "Waiting for biometric..."
     * with its passphrase button disabled, and every later attempt would be
     * answered with "Another biometric request is already in progress".
     */
    @Override
    protected void handleOnDestroy() {
        cancelInFlight("The biometric prompt was interrupted");
        super.handleOnDestroy();
    }
}
