import React, { useEffect, useState } from "react";
import {
  ShieldCheck,
  LockKey,
  Plugs,
  IdentificationCard,
  UserCircle,
  SignOut,
  FloppyDisk,
} from "@phosphor-icons/react";
export default function AdminSettings({ studio, ui, Settings }) {
  const { setSettings, setToast } = studio;
  const { PageHeading, Field, Button, nativeCall } = ui;
  const [admin, setAdmin] = useState({
      authenticated: false,
      username: "",
    }),
    [loading, setLoading] = useState(!!window.studio),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [repeatPassword, setRepeatPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [section, setSection] = useState("models"),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState("");
  useEffect(() => {
    if (window.studio)
      nativeCall("adminStatus")
        .then((meta) => {
          setAdmin(meta);
          setUsername(meta.username || "");
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
  }, []);
  async function login(e) {
    e.preventDefault();
    setError("");
    if (admin.needsSetup && password !== repeatPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      if (window.studio) {
        const loggedIn = await nativeCall(admin.needsSetup ? "adminCreate" : "adminLogin", {
          username: username.trim(), password,
        });
        setPassword("");
        setRepeatPassword("");
        try {
          setSettings(await nativeCall("getSettings"));
        } catch (loadError) {
          setToast(loadError.message);
        }
        setAdmin(loggedIn);
        setUsername(loggedIn.username);
      } else {
        setAdmin({
          authenticated: true,
          username: "演示账户",
          isDefault: false,
        });
      }
      setPassword("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      if (window.studio) {
        await nativeCall("adminLogout");
        setSettings(await nativeCall("getSettings"));
      }
      setAdmin((meta) => ({ ...meta, authenticated: false }));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError("");
      setToast("已退出管理员后台");
    } catch (e) {
      setError(e.message);
    }
  }
  async function changePassword(e) {
    e.preventDefault();
    setError("");
    if (!window.studio) {
      setError("密码修改请在 Mac App 中操作，浏览器仅演示登录界面。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次新密码不一致。");
      return;
    }
    setBusy(true);
    try {
      await nativeCall("adminChangePassword", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setAdmin((a) => ({ ...a, isDefault: false }));
      setToast("管理员密码已修改");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="skeleton-output">
        <i />
        <i />
        <i />
      </div>
    );
  if (!admin.authenticated)
    return (
      <>
        <PageHeading
          eyebrow="ADMIN CONSOLE"
          title="管理你的创作连接。"
          description="管理员登录后，可为这台 Mac 绑定 AI 服务和管理连接。"
        />
        <div className="admin-login-layout">
          <section className="admin-intro">
            <span className="admin-shield">
              <ShieldCheck size={34} weight="thin" />
            </span>
            <div className="eyebrow">ONE STUDIO. YOUR MODELS.</div>
            <h2>
              让 AI 就位，
              <br />
              让故事开场。
            </h2>
            <p>
              在一个地方管理模型连接。
              <br />
              创作者专注于故事，配置留在后台。
            </p>
            <div className="admin-intro-features">
              <div>
                <LockKey size={18} />
                <span>模型配置加密保存在本机</span>
              </div>
              <div>
                <Plugs size={18} />
                <span>自选服务商与模型</span>
              </div>
              <div>
                <IdentificationCard size={18} />
                <span>为整个创作空间提供 AI 能力</span>
              </div>
            </div>
            <span className="admin-wordmark">MANXU / ADMIN</span>
          </section>
          <form className="admin-login-form" onSubmit={login}>
            <div className="login-avatar">
              <UserCircle size={32} weight="thin" />
            </div>
            <h2>{admin.needsSetup ? "创建本机管理员" : "管理员登录"}</h2>
            <p>{admin.needsSetup
              ? "首次设置模型或备份服务时，请为这台 Mac 创建账号和密码。"
              : "登录后管理这台 Mac 的模型与备份连接。"}</p>
            {window.studio && (
              <>
                <Field label="管理员账号">
                  <input
                    autoComplete="username"
                    maxLength={64}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    placeholder="请输入管理员账号"
                  />
                </Field>
                <Field label="管理员密码">
                  <input
                    type="password"
                    autoComplete={admin.needsSetup ? "new-password" : "current-password"}
                    minLength={admin.needsSetup ? 8 : undefined}
                    maxLength={admin.needsSetup ? 128 : 256}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="请输入管理员密码"
                  />
                </Field>
                {admin.needsSetup && (
                  <Field label="确认密码" helper="设置 8–128 个字符的独立密码。">
                    <input type="password" autoComplete="new-password"
                      value={repeatPassword} onChange={(e) => setRepeatPassword(e.target.value)}
                      required minLength={8} maxLength={128} placeholder="再次输入管理员密码" />
                  </Field>
                )}
              </>
            )}
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <Button
              kind="primary"
              className="full-width"
              type="submit"
              icon={LockKey}
              disabled={busy}
            >
              {busy
                ? "正在验证…"
                : window.studio
                  ? (admin.needsSetup ? "创建本机管理员" : "登录管理后台")
                  : "打开后台演示"}
            </Button>
            {window.studio && admin.isDefault && (
              <p className="browser-admin-note">
                首次登录后，可在「账户安全」修改初始密码。
              </p>
            )}
            {!window.studio && (
              <p className="browser-admin-note">
                浏览器不保存管理员资料；API 绑定与密码管理请在 Mac App 中完成。
              </p>
            )}
          </form>
        </div>
      </>
    );
  return (
    <>
      <div className="admin-console-bar">
        <div>
          <ShieldCheck size={18} />
          <strong>管理员控制台</strong>
          <span className="badge">{admin.username}</span>
        </div>
        <div>
          <button
            className={section === "models" ? "active" : ""}
            onClick={() => {
              setSection("models");
              setError("");
            }}
          >
            模型绑定
          </button>
          <button
            className={section === "account" ? "active" : ""}
            onClick={() => {
              setSection("account");
              setError("");
            }}
          >
            账户安全
          </button>
          <Button icon={SignOut} onClick={logout}>
            退出登录
          </Button>
        </div>
      </div>
      {section === "models" ? (
        <Settings authenticated />
      ) : (
        <>
          <PageHeading
            eyebrow="ACCOUNT SECURITY"
            title="管理你的管理员密码。"
            description="修改后，下次登录使用新密码。账号保持不变。"
          />
          <form className="admin-password-form" onSubmit={changePassword}>
            <div className="panel-title">
              <h2>
                <LockKey size={20} /> 修改管理员密码
              </h2>
              <span className="badge">
                {admin.isDefault ? "当前为初始密码" : "已设置个人密码"}
              </span>
            </div>
            <div className="settings-fields">
              <Field label="当前密码">
                <input
                  required
                  autoComplete="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </Field>
              <Field
                label="新密码"
                helper="设置 8–128 个字符的独立密码。"
              >
                <input
                  required
                  autoComplete="new-password"
                  type="password"
                  minLength={8}
                  maxLength={128}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <Field label="再次输入新密码">
                <input
                  required
                  autoComplete="new-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
              {error && (
                <div className="inline-error" role="alert">
                  {error}
                </div>
              )}
              <Button
                kind="primary"
                icon={FloppyDisk}
                type="submit"
                disabled={busy}
              >
                {busy ? "正在保存…" : "保存新密码"}
              </Button>
            </div>
          </form>
        </>
      )}
    </>
  );
}
