module.exports = {
  apps: [
    {
      name: "youconnext-notifications",
      script: "src/server.js",
      instances: "max", // Escalamiento horizontal con modo cluster
      exec_mode: "cluster",
      autorestart: true, // CRIT-04: Auto-reinicio ante saturación o fallo inesperado
      watch: false,
      max_memory_restart: "500M", // Reinicio proactivo si la memoria sobrepasa 500MB
      env: {
        NODE_ENV: "development",
        PORT: 3004,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3004,
      },
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      log_file: "logs/pm2-combined.log",
      time: true,
      kill_timeout: 5000,
      wait_ready: false,
      listen_timeout: 8000,
      exp_backoff_restart_delay: 100, // Backoff exponencial en reinicios
    },
  ],
};
