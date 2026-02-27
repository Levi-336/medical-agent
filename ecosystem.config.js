module.exports = {
  apps: [
    {
      name: 'medical-agent',
      script: 'npm',
      args: 'start', // 或者使用 'next start' 如果全局安装了 next
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // 在服务器上配置环境变量，或在此处填入 (不推荐提交到仓库)
        // ZHIPU_API_KEY: 'your_key_here' 
      },
    },
  ],
};
