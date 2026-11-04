/**
 * Implementación de Circuit Breaker para resiliencia y protección ante fallos
 * en servicios de terceros (FCM, SMTP, APIs externas).
 * CRIT-03 & CRIT-04: Evita el bloqueo del event loop y agotamiento de sockets.
 */
class CircuitBreaker {
  /**
   * @param {string} serviceName - Nombre del servicio protegido (ej. "FirebaseFCM", "ZohoSMTP")
   * @param {object} options
   * @param {number} [options.failureThreshold=5] - Fallos consecutivos para abrir el circuito
   * @param {number} [options.recoveryTimeoutMs=30000] - Tiempo en milisegundos en estado OPEN antes de probar HALF-OPEN
   * @param {number} [options.callTimeoutMs=10000] - Timeout máximo por llamada individual
   */
  constructor(serviceName, options = {}) {
    this.serviceName = serviceName;
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs || 30000;
    this.callTimeoutMs = options.callTimeoutMs || 10000;

    this.state = "CLOSED"; // "CLOSED", "OPEN", "HALF-OPEN"
    this.consecutiveFailures = 0;
    this.nextAttempt = Date.now();
    this.totalSuccesses = 0;
    this.totalFailures = 0;
  }

  /**
   * Ejecuta una función asíncrona dentro de la protección del circuit breaker.
   *
   * @param {Function} asyncFn - Función asíncrona a ejecutar
   * @returns {Promise<any>}
   */
  async execute(asyncFn) {
    if (this.state === "OPEN") {
      if (Date.now() > this.nextAttempt) {
        this.state = "HALF-OPEN";
        console.warn(
          `[CircuitBreaker:${this.serviceName}] Pasando a HALF-OPEN para probar disponibilidad.`,
        );
      } else {
        const remainingSeconds = Math.ceil(
          (this.nextAttempt - Date.now()) / 1000,
        );
        const error = new Error(
          `Servicio ${this.serviceName} temporalmente inaccesible (Circuito ABIERTO). Reintento en ${remainingSeconds}s.`,
        );
        error.code = "CIRCUIT_BREAKER_OPEN";
        error.retryAfter = remainingSeconds;
        throw error;
      }
    }

    let timerId = null;
    try {
      // Envolver con timeout estricto para evitar bloqueos indefinidos
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => {
          const timeoutError = new Error(
            `Timeout excedido (${this.callTimeoutMs}ms) en llamada a ${this.serviceName}`,
          );
          timeoutError.code = "OPERATION_TIMEOUT";
          reject(timeoutError);
        }, this.callTimeoutMs);
        if (timerId && typeof timerId.unref === "function") {
          timerId.unref();
        }
      });

      const result = await Promise.race([asyncFn(), timeoutPromise]);
      if (timerId) clearTimeout(timerId);

      this._onSuccess();
      return result;
    } catch (err) {
      if (timerId) clearTimeout(timerId);
      this._onFailure(err);
      throw err;
    }
  }

  _onSuccess() {
    this.consecutiveFailures = 0;
    this.totalSuccesses++;
    if (this.state === "HALF-OPEN") {
      this.state = "CLOSED";
      console.log(
        `[CircuitBreaker:${this.serviceName}] Servicio recuperado. Circuito restaurado a CLOSED.`,
      );
    }
  }

  _onFailure(err) {
    this.consecutiveFailures++;
    this.totalFailures++;

    if (
      this.state === "HALF-OPEN" ||
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.state = "OPEN";
      this.nextAttempt = Date.now() + this.recoveryTimeoutMs;
      console.error(
        `[CircuitBreaker:${this.serviceName}] UMBRAL DE FALLOS ALCANZADO (${this.consecutiveFailures}). Circuito ABIERTO durante ${this.recoveryTimeoutMs / 1000}s. Causa: ${err.message}`,
      );
    }
  }

  getStatus() {
    return {
      service: this.serviceName,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      isOpen: this.state === "OPEN",
    };
  }
}

module.exports = CircuitBreaker;
