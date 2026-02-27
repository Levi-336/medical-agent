# Medical Agent 部署指南 (CentOS 7)

## 📦 仓库地址
- GitHub: https://github.com/jiushan-test/Medical-Agent

---

由于 CentOS 7 系统较老（已于 2024 年停止维护），直接安装最新的 Node.js 18/20 和编译 SQLite 依赖可能会遇到 `glibc` 版本过低或 GCC 版本过低的问题。

**强烈推荐使用方案一（Docker 部署），它可以屏蔽系统差异，一键运行。**

---

## 方案一：Docker 部署 (推荐 🌟)

此方案最稳健，无需在 CentOS 7 上折腾 Node.js 和编译环境。

如果你需要“构建一次、其他机器直接拉取”的部署方式（以及把基础镜像搬进 ACR 以彻底绕开 DockerHub），参考：DEPLOY_ACR.md

### 1. 安装 Docker (如果尚未安装)
```bash
# 移除旧版本
sudo yum remove docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine

# 安装依赖
sudo yum install -y yum-utils

# 设置仓库 (阿里云镜像加速)
sudo yum-config-manager --add-repo http://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo

# 安装 Docker Engine
sudo yum install -y docker-ce docker-ce-cli containerd.io

# 配置 Docker 镜像加速 (解决国内拉取超时问题)
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1panel.live",
    "https://mirror.ccs.tencentyun.com"
  ]
}
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker

# 启动 Docker
sudo systemctl start docker
sudo systemctl enable docker
```

### 2. 获取代码并部署
1.  **克隆仓库**：
    ```bash
    git clone https://github.com/jiushan-test/Medical-Agent.git
    cd Medical-Agent
    ```
2.  **构建镜像**：
    在项目根目录下运行：
    ```bash
    docker build -t medical-agent .
    ```
3.  **运行容器**：
    ```bash
    # 运行在 3000 端口，数据文件挂载到宿主机以防丢失
    docker run -d \
      --name medical-agent \
      -p 3000:3000 \
      -e ZHIPU_API_KEY="你的Key" \
      -v $(pwd)/data:/app/data \
      --restart always \
      medical-agent
    ```
    *注意：由于 SQLite 是文件数据库，Docker 内部路径需要持久化。上面的 `-v` 命令将当前目录下的 `data` 映射进去。你需要确保代码中 `db.ts` 使用的路径在 Docker 内是可写的。*
    *目前的 `Dockerfile` 是基于 Standalone 模式，建议检查 `lib/db.ts` 确保数据库文件路径正确（推荐使用绝对路径或 `process.cwd()`）。*

---

## 方案二：手动部署 (Node.js + PM2)

如果你必须直接运行在主机上，请按以下步骤操作。

### 1. 环境准备
CentOS 7 默认源的 Node.js 版本太旧，必须手动安装。

**安装 Node.js 18 (LTS):**
```bash
# 1. 安装 NodeSource 仓库
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -

# 2. 安装 Node.js
sudo yum install -y nodejs

# 3. 验证 (必须 >= 18.17.0)
node -v
npm -v
```

**安装编译工具 (用于 SQLite):**
```bash
# better-sqlite3 需要 Python 3 和 编译工具
sudo yum install -y gcc-c++ make
```
*注意：如果 `better-sqlite3` 安装失败报错 GCC 版本过低，你需要安装 `devtoolset-9`。*

### 2. 获取代码并安装
1.  **克隆仓库**：
    ```bash
    git clone https://github.com/jiushan-test/Medical-Agent.git
    cd Medical-Agent
    ```
2.  **安装依赖**：
    ```bash
    npm install
    ```
3.  **构建项目**：
    ```bash
    npm run build
    ```

### 3. 启动服务 (PM2)
使用 PM2 进程守护，保证服务崩溃重启和后台运行。

```bash
# 1. 安装 PM2
npm install -g pm2

# 2. 设置环境变量并启动
# 方式 A: 命令行直接启动
ZHIPU_API_KEY="你的Key" pm2 start npm --name "medical-agent" -- start

# 方式 B: 使用 ecosystem.config.js (已在项目中创建)
# 先编辑 ecosystem.config.js 填入 Key，然后运行:
pm2 start ecosystem.config.js
```

### 4. 配置 Nginx 反向代理 (可选)
让用户通过域名或 80 端口访问，而不是 3000。

1.  **安装 Nginx**:
    ```bash
    sudo yum install -y epel-release
    sudo yum install -y nginx
    sudo systemctl start nginx
    ```
2.  **配置**:
    编辑 `/etc/nginx/conf.d/medical.conf`:
    ```nginx
    server {
        listen 80;
        server_name your_domain_or_ip;

        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }
    }
    ```
3.  **重载**:
    ```bash
    sudo nginx -t
    sudo systemctl reload nginx
    ```

## 常见问题
1.  **SQLite 报错**: 如果遇到 `GLIBC_2.28 not found`，说明 Node.js 版本或 SQLite 二进制文件不兼容 CentOS 7。**请转用 Docker 方案**。
2.  **端口防火墙**: 记得放行端口。
    ```bash
    firewall-cmd --zone=public --add-port=3000/tcp --permanent
    firewall-cmd --zone=public --add-port=80/tcp --permanent
    firewall-cmd --reload
    ```
