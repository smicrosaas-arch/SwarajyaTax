const CryptoJS = require('crypto-js');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'swarajya-tax-default-secret-key-32chars';

/**
 * Encrypts a string using AES-256
 */
function encrypt(text) {
    if (!text) return null;
    return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

/**
 * Decrypts a string using AES-256
 */
function decrypt(ciphertext) {
    if (!ciphertext) return null;
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
        const originalText = bytes.toString(CryptoJS.enc.Utf8);
        if (!originalText) throw new Error('Decryption failed');
        return originalText;
    } catch (err) {
        console.error('[Crypto] Decryption error:', err.message);
        return null;
    }
}

module.exports = { encrypt, decrypt };
