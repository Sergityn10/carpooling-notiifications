/**
 * Re-exportación unificada del módulo de seguridad para compatibilidad con rutas existentes.
 */
const {
  requireAuth,
  requireRole,
  requireAdmin,
  requireOwnership,
  verifyStrictToken,
} = require("../security");

module.exports = {
  requireAuth,
  requireRole,
  requireAdmin,
  requireOwnership,
  verifyStrictToken,
};
