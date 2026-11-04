/**
 * Utilidades de sanitización y validación segura de inputs y DTOs de salida.
 * Evita inyecciones de código, datos malformados y fuga de campos sensibles.
 */

/**
 * Valida formato estricto de dirección de correo electrónico según RFC 5322 simplificado.
 */
function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return regex.test(email.trim());
}

/**
 * Sanitiza una cadena eliminando caracteres de control y etiquetas HTML potencialmente peligrosas.
 */
function sanitizeString(input, maxLength = 1000) {
  if (typeof input !== "string") return "";
  return input
    .replace(/<[^>]*>/g, "") // Elimina etiquetas HTML
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // Elimina caracteres de control ASCII
    .trim()
    .slice(0, maxLength);
}

/**
 * Filtro DTO universal: garantiza que nunca se serialicen campos sensibles de usuarios.
 * HIGH-01 / RGPD Art. 5 y 32.
 */
const SENSITIVE_FIELDS = [
  "password",
  "password_hash",
  "contrasena",
  "dni",
  "nie",
  "nif",
  "stripe_account",
  "stripe_account_id",
  "stripe_customer_account",
  "stripeCustomerId",
  "stripeAccountId",
  "creditCard",
  "cvv",
];

function sanitizeOutput(obj) {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeOutput);
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_FIELDS.some(
      (field) => lowerKey === field.toLowerCase() || lowerKey.includes("password"),
    );

    if (!isSensitive) {
      clean[key] =
        typeof value === "object" && value !== null ? sanitizeOutput(value) : value;
    }
  }

  return clean;
}

module.exports = {
  isValidEmail,
  sanitizeString,
  sanitizeOutput,
  SENSITIVE_FIELDS,
};
