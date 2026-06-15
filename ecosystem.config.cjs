module.exports = {
  apps: [
    {
      name: "handlebot",
      script: "./start.sh",
      interpreter: "sh",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      time: true,
      restart_delay: 5000,
    },
  ],
};
