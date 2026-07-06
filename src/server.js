const express = require("express");
const cors = require("cors");
const config = require("./config");
const emailRoutes = require("./routes/emailRoutes");
const pushRoutes = require("./routes/pushRoutes");
const deviceTokenRoutes = require("./routes/deviceTokenRoutes");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "carpooling-notifications",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/emails", emailRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/device-tokens", deviceTokenRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Notifications service running on port ${config.port} [${config.nodeEnv}]`);
});

module.exports = app;
