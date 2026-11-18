# 漫序云备份与模型服务

可以在自己的 Ubuntu 主机上部署备份服务。Mac 在本机加密项目，服务只接收可由漫序校验的 `.manxu` 信封。恢复时，Mac 下载密文，再用文件密码解密。设备访问令牌控制云服务访问，文件密码用于解密，两者独立保管。云端没有重置文件密码的能力。

模型服务使用 OpenAI Responses API 和 `gpt-6.2-sol`，可以单独启用。仅启用项目备份时可省略 `OPENAI_API_KEY`，备份和恢复照常工作。需要 GPT 时使用具有访问资格且位于官方支持地区的服务环境。[OpenAI 支持地区](https://developers.openai.com/api/docs/supported-countries/) · [模型说明](https://developers.openai.com/api/docs/models/gpt-6.2-sol)

## 在现有 Ubuntu 主机上启用磁盘备份

1. 确认目标主机和已有站点，检查 `node --version`、`command -v node`、`ss -ltn` 和可用磁盘空间。需要受维护的 Node.js 22 或以上版本，磁盘模式运行时只使用 Node 自带模块。
2. 在 Mac 完整源码根目录运行下列命令，将生成的后端部署包通过已认证的 SSH/SFTP 传至服务器。这条命令拒绝覆盖同名的现有包。

   ```sh
   ./cloud/package-server.sh disk /tmp/manxu-lighthouse.tar.gz
   shasum -a 256 /tmp/manxu-lighthouse.tar.gz
   ```

3. 在服务器核对 `sha256sum` 后，创建目录和独立服务用户。下例适用于首次安装。升级时先保留原程序目录，保留服务配置和数据目录，再替换程序并重启服务。

   ```sh
   sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin manxu-cloud
   sudo install -d -m 755 /opt/manxu-cloud
   sudo tar -xzf /tmp/manxu-lighthouse.tar.gz -C /opt/manxu-cloud --no-same-owner
   sudo chown -R root:manxu-cloud /opt/manxu-cloud
   sudo chmod -R u=rwX,g=rX,o= /opt/manxu-cloud
   sudo install -d -m 700 -o manxu-cloud -g manxu-cloud /var/lib/manxu-cloud/backups
   sudo install -d -m 700 -o root -g root /etc/manxu-cloud
   ```

   默认使用系统盘的持久目录。如果希望使用已经挂载的数据盘，可以先在那块盘上建立由 `manxu-cloud` 拥有的专属目录，再通过 bind mount 挂载到 `/var/lib/manxu-cloud/backups`。确认 `findmnt -T /var/lib/manxu-cloud/backups` 和 `df -h /var/lib/manxu-cloud/backups` 指向预期设备，并把该挂载加入持久挂载配置。不要格式化已有磁盘。服务在重启时会等待已声明的挂载就绪。

4. 在 Mac 的密码管理器生成 64 个随机十六进制字符作为设备令牌并保管原值。服务器只需要这段原始文本（不含换行）的 SHA-256 十六进制摘要。可以在 Mac 终端用下面的方式隐去输入，输出仅为摘要。

   ```zsh
   read -rs 'device_token?粘贴设备令牌：'
   print
   printf '%s' "$device_token" | shasum -a 256
   unset device_token
   ```

   在服务器将下面的 `<64位摘要>` 换为该摘要。首次创建配置时使用 noclobber 保留已有文件。

   ```sh
   sudo sh -c 'set -eC; umask 077; printf "%s\n" HOST=127.0.0.1 PORT=8787 BACKUP_DRIVER=disk BACKUP_DIR=/var/lib/manxu-cloud/backups "MANXU_CLOUD_TOKEN_SHA256=<64位摘要>" > /etc/manxu-cloud/service.env'
   sudo chmod 600 /etc/manxu-cloud/service.env
   sudo install -m 644 /opt/manxu-cloud/cloud/deploy/manxu-cloud.service /etc/systemd/system/manxu-cloud.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now manxu-cloud
   curl --fail http://127.0.0.1:8787/healthz
   ```

   `systemd` 模板默认使用 `/usr/bin/node`。如果使用安装在 `/opt` 的官方 Node 24 LTS，先用对应版本的 `SHASUMS256.txt` 校验与主机架构相符的压缩包，再把 unit 的 `ExecStart` 改为提取后的 Node 绝对路径。可使用 systemd drop-in，先写一条空的 `ExecStart=`，下一行给出新的完整命令。健康检查返回 `{"ok":true}` 表示进程可用。存储、设备凭据和 GPT 分别通过下面的验收步骤核对。[Node 官方发行包与校验](https://nodejs.org/dist/latest-v24.x/)

5. 让已启用 HTTPS 的入口把 `/manxu/` 转发至 `http://127.0.0.1:8787/`。Nginx 的 location 示例在 `cloud/deploy/manxu-nginx.location.conf`，可以将它放进目标域名已有的 TLS server 块，先 `nginx -t` 后重载。保留服务器已有站点和其他转发路径。若使用 Caddy，可在相应 HTTPS 站点内加入以下配置。没有可验证的 HTTPS 域名和证书时，先完成域名解析和 TLS 配置，保持服务端口仅本机可达。

   ```caddyfile
   handle_path /manxu/* {
       reverse_proxy 127.0.0.1:8787
   }
   ```

6. 在 Mac 管理后台保存云服务地址，例如 `https://你的域名/manxu`，并填入设备令牌。公网安全组仅开放实际使用的 HTTPS 入口，SSH 按原有管理方式保留。不要对外开放裸 HTTP 服务端口 8787。若反向代理、负载均衡或监控会记录请求内容，请关闭这些路径的 Authorization、请求体和响应体记录。

## 验收与运维

- 通过 HTTPS 访问 `/manxu/healthz`。对 `/manxu/v1/backups` 发出未携带令牌的请求应得到 401。Mac 端上传加密项目、重新加载列表并恢复到新项目；再重启服务器进程，确认同一备份仍能下载、解密。
- 磁盘存储每个完整备份为 `slot-NN/<随机 UUID>.manxu`。服务通过原子目录重命名发布备份。专属目录权限为 0700，文件权限为 0600。最多保存 50 份，单份明文上限 25 MiB，序列化密文略大于 33 MiB。满额时归档旧槽到其他受控存储、验证可解密，再将旧槽移出备份目录。程序不会自动清理已保存的作品。单机盘备份与主机共享故障域，可另存一份加密文件。
- 设备令牌轮换时，在 Mac 生成新令牌，更新服务器端的 `MANXU_CLOUD_TOKEN_SHA256`，重启服务，并在 Mac 绑定新令牌。旧备份仍由原文件密码保护。
- 若配置了合法可用的 `OPENAI_API_KEY`，Mac 上的连接测试会向模型发送一张合成双色图。其他生成仅发送操作选择的文本或图片。模型请求按账户计费，备份接口可独立测试。每实例每分钟最多接受 30 个已认证请求，同时最多处理 4 个业务请求、2 个模型请求。服务不保存模型提示词和响应。

## 选择腾讯 COS 或 CloudBase Run

为服务准备专用私有 COS 桶，关闭公共访问，使用从未启用版本控制的桶。服务通过 HTTPS 将客户端密文写入 `manxu/v1/backups/`，同时请求 COS 的 AES256 服务端加密和禁止覆盖写。所需权限为桶的 `cos:GetBucket`、`cos:GetBucketVersioning`，以及限定到该前缀的 `cos:HeadObject`、`cos:GetObject`、`cos:PutObject`。给专用 CAM 身份授权，优先使用临时会话凭证并在过期前更新。COS 读写失败时，服务向客户端返回操作错误。[COS Node.js 官方 SDK](https://github.com/tencentyun/cos-nodejs-sdk-v5) · [PutObject 防覆盖约束](https://cloud.tencent.com/document/product/436/7749)

容器镜像在完整项目根目录构建。使用 Docker BuildKit，它会读取 `cloud/Dockerfile.dockerignore` 的白名单。选择 `--target cos` 后镜像会安装锁定版本的腾讯 COS SDK。选择 `--target disk` 时使用持久挂载并确保服务用户 UID 1000 对专用目录有权限。CloudBase Run 实例可能伸缩，云托管使用 COS 目标并配置单实例上限，保持预期的单人限流。可以把预构建镜像推到自己的私有镜像仓库后再从云托管引用。[腾讯云托管部署说明](https://cloud.tencent.com/document/product/1243/49235)

```sh
docker buildx build --platform linux/amd64 --target cos -f cloud/Dockerfile -t manxu-private:cos --load .
```

云托管容器监听 `0.0.0.0:8080`，使用平台 HTTPS 域名。运行时注入变量如下。

| 变量 | 用途 |
| --- | --- |
| `MANXU_CLOUD_TOKEN_SHA256` | 建议配置项，原始设备令牌 UTF-8 字节的 SHA-256 摘要（64 位十六进制） |
| `MANXU_CLOUD_TOKEN` | 可选替代项，独立随机服务令牌。与 SHA256 配置项二选一 |
| `BACKUP_DRIVER` | `disk` 或 `cos` |
| `BACKUP_DIR` | 磁盘后端的持久绝对路径 |
| `COS_BUCKET`、`COS_REGION` | 私有桶名（含 APPID）和实际地域 |
| `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_SESSION_TOKEN` | 具有限定权限的服务身份。临时凭证需要会话令牌 |
| `OPENAI_API_KEY` | 可选，模型服务资格与网络条件满足后配置 |
| `HOST`、`PORT` | 独立进程默认 127.0.0.1:8080；容器模板监听所有容器接口 |

单 Owner 模式下，受信任设备共用一个云令牌。没有云端删除、公开下载链接或跨用户账号功能。

## 本地检查

```sh
npm --prefix cloud ci --ignore-scripts
npm --prefix cloud test
```

测试使用临时私有目录、模拟 COS 和模拟 OpenAI 响应，覆盖磁盘恢复、并发上限、文件权限、密文传输、鉴权、模型契约、失败与限流。部署到真实账号后的验收需要目标主机和 HTTPS 入口。
