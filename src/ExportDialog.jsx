import { useId, useState } from "react";
import { LockKey, X } from "@phosphor-icons/react";
import {
  MAX_EXPORT_PASSWORD_LENGTH,
  MIN_EXPORT_PASSWORD_LENGTH,
} from "./portable";

export default function ExportDialog({ mode, onSubmit, onClose }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const helpId = useId();
  const encrypt = mode === "encrypt";
  const close = () => {
    if (!busy) onClose();
  };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (
      !password.trim() ||
      (encrypt && password.length < MIN_EXPORT_PASSWORD_LENGTH)
    ) {
      setError(
        encrypt
          ? `请输入至少 ${MIN_EXPORT_PASSWORD_LENGTH} 个字符的文件密码。`
          : "请输入文件密码。",
      );
      return;
    }
    if (encrypt && password !== confirmation) {
      setError("两次输入的密码不一致。");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await onSubmit(password);
      setPassword("");
      setConfirmation("");
      onClose();
    } catch (err) {
      setError(err?.message || "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  function handleKeys(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key !== "Tab") return;
    if (busy) {
      event.preventDefault();
      return;
    }
    const focusable = event.currentTarget.querySelectorAll(
      "input:not(:disabled), button:not(:disabled)",
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      className="modal-overlay portable-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <form
        className="modal portable-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={helpId}
        aria-busy={busy}
        onSubmit={submit}
        onKeyDown={handleKeys}
      >
        <div className="modal-head">
          <span className="tool-icon">
            <LockKey size={24} />
          </span>
          <button
            className="icon-button"
            aria-label="关闭"
            title="关闭"
            type="button"
            disabled={busy}
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>
        <h2 id={titleId}>{encrypt ? "加密导出" : "解锁加密文件"}</h2>
        <p id={helpId}>
          {encrypt
            ? `用至少 ${MIN_EXPORT_PASSWORD_LENGTH} 个字符设置一个独立的文件密码。请妥善保管；没有它，文件无法恢复。`
            : "输入导出时设置的文件密码。解密在本机进行。"}
        </p>
        <label className="field">
          <span>文件密码</span>
          <input
            autoFocus
            type="password"
            autoComplete="off"
            maxLength={MAX_EXPORT_PASSWORD_LENGTH}
            value={password}
            disabled={busy}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
          />
        </label>
        {encrypt && (
          <label className="field">
            <span>再次输入文件密码</span>
            <input
              type="password"
              autoComplete="off"
              maxLength={MAX_EXPORT_PASSWORD_LENGTH}
              value={confirmation}
              disabled={busy}
              onChange={(e) => {
                setConfirmation(e.target.value);
                setError("");
              }}
            />
          </label>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <button
          className="btn primary full-width"
          type="submit"
          disabled={busy}
        >
          {busy
            ? encrypt
              ? "正在加密…"
              : "正在解密…"
            : encrypt
              ? "加密并导出"
              : "解密并打开"}
        </button>
      </form>
    </div>
  );
}
