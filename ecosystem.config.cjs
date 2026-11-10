module.exports = {
  apps: [
    {
      name: "youconnext-notifications-api",
      script: "src/server.js",
      // 1 instancia mantiene consistentes rate-limit e idempotencia en memoria sin Redis en VPS
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "development",
        PORT: 3004,
        RUN_WORKERS: "false",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3004,
        RUN_WORKERS: "false",
      },
      error_file: "logs/pm2-api-error.log",
      out_file: "logs/pm2-api-out.log",
      time: true,
      kill_timeout: 5000,
      exp_backoff_restart_delay: 100,
    },
    {
      name: "youconnext-notifications-worker",
      script: "src/worker.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "450M",
      env: {
        NODE_ENV: "development",
        RUN_WORKERS: "true",
      },
      env_production: {
        NODE_ENV: "production",
        RUN_WORKERS: "true",
      },
      error_file: "logs/pm2-worker-error.log",
      out_file: "logs/pm2-worker-out.log",
      time: true,
      kill_timeout: 10000,
      exp_backoff_restart_delay: 100,
    },
  ],
};
