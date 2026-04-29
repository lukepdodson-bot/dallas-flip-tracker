module.exports = {
  apps: [
    {
      name: 'dallas-flip-tracker',
      script: './backend/server.js',
      cwd: '/Users/lukepdodson/dallas-foreclosures',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      watch: false,
      max_memory_restart: '256M',
      // Restart if it crashes
      autorestart: true,
      restart_delay: 3000,
    },
  ],
};
