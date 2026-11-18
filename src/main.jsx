import {version as appVersion} from "../package.json";
import AdminSettings from "./AdminSettings";
import ExportDialog from "./ExportDialog";
import {
  decryptPortable,
  encryptPortable,
  MAX_PORTABLE_BYTES,
  PORTABLE_EXTENSION,
} from "./portable";
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "motion/react";
import {
  SquaresFour,
  FolderSimple,
  MagicWand,
  IdentificationCard,
  FilmStrip,
  BookOpen,
  Plugs,
  Plus,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  CaretRight,
  CaretDown,
  MagnifyingGlass,
  Command,
  Check,
  CheckCircle,
  Copy,
  Download,
  UploadSimple,
  Play,
  LockKey,
  SlidersHorizontal,
  X,
  Clock,
  ImageSquare,
  FileText,
  FloppyDisk,
  WarningCircle,
  Trash,
  SpeakerHigh,
  MonitorPlay,
  ArrowClockwise,
  Lightbulb,
  VideoCamera,
  Stack,
  SidebarSimple,
  SignOut,
  ShieldCheck,
  UserCircle,
} from "@phosphor-icons/react";
import {
  asset,
  initialProject,
  hasSampleVideo,
  initialRole,
  initialShots,
  initialPrompt,
  lessons,
  demoAnalysis,
} from "./data";
import {
  buildPrompt,
  buildExercisePrompt,
  demoPrompt,
  parseExercise,
  validateProject,
  extractFrames,
} from "./logic";
import "./styles.css";
const Context = createContext(null);
const useStudio = () => useContext(Context);
const uid = () => crypto.randomUUID();
const blankWorkspace = () => ({
  roles: [],
  shots: [],
  prompt: "",
  history: [],
});
const initial = {
  projects: [initialProject],
  activeId: initialProject.id,
  workspaces: {
    [initialProject.id]: {
      roles: [initialRole],
      shots: initialShots,
      prompt: initialPrompt,
      history: [],
    },
  },
  completed: [],
};
const nav = [
  ["home", "工作台", SquaresFour],
  ["projects", "项目空间", FolderSimple],
  ["prompts", "提示词工坊", MagicWand],
  ["characters", "角色卡片", IdentificationCard],
  ["storyboard", "分镜脚本", FilmStrip],
  ["analysis", "参考片拆解", MonitorPlay],
  ["learn", "新手学院", BookOpen],
];
const LEGACY_STORAGE_KEY = "manxu.public.workspace.v1";
async function nativeCall(method, data) {
  const result = await window.studio[method](data);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
function Button({
  children,
  icon: Icon,
  onClick,
  kind = "",
  className = "",
  ...props
}) {
  return (
    <button className={`btn ${kind} ${className}`} onClick={onClick} {...props}>
      {Icon && <Icon size={17} weight="regular" />}
      {children}
    </button>
  );
}
function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      <Icon size={19} />
    </button>
  );
}
function Field({ label, helper, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {helper && <small>{helper}</small>}
    </label>
  );
}
function Badge({ children, orange = false }) {
  return <span className={`badge ${orange ? "orange" : ""}`}>{children}</span>;
}
function PageHeading({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function App() {
  const [startingState, setStartingState] = useState(
    window.studio ? null : initial,
  );
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      const previous = localStorage.getItem(LEGACY_STORAGE_KEY);
      const saved = await nativeCall("loadWorkspace", previous);
      // The main process only returns after the encrypted migration is durable.
      if (previous !== null) localStorage.removeItem(LEGACY_STORAGE_KEY);
      setStartingState(saved ?? initial);
    } catch (err) {
      setError(err.message || "无法读取本机加密仓库。");
    }
  }
  useEffect(() => {
    if (window.studio) load();
  }, []);
  if (startingState) return <StudioApp startingState={startingState} />;
  return (
    <main className="privacy-gate">
      <section aria-live="polite">
        <span className="tool-icon">
          <LockKey size={25} />
        </span>
        <h1>{error ? "无法打开加密工作区" : "正在打开加密工作区"}</h1>
        <p>{error || "如 macOS 请求钥匙串权限，请在系统弹窗中允许访问。"}</p>
        {error && (
          <Button kind="primary" icon={ArrowClockwise} onClick={load}>
            重试
          </Button>
        )}
      </section>
    </main>
  );
}
function StudioApp({ startingState }) {
  const [state, setState] = useState(startingState),
    [route, setRoute] = useState(window.studio && location.hash === "#settings" ? "settings" : "home"),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState(null),
    [passwordTask, setPasswordTask] = useState(null),
    [openedText, setOpenedText] = useState(null),
    [command, setCommand] = useState(false),
    [demo, setDemo] = useState(true),
    [settings, setSettings] = useState({ hasKey: false, apiAvailable: false }),
    [storageStatus, setStorageStatus] = useState("saved"),
    [retryStorage, setRetryStorage] = useState(0);
  const current =
    state.projects.find((p) => p.id === state.activeId) || state.projects[0];
  const workspace = state.workspaces[current.id] || blankWorkspace();
  useLayoutEffect(() => {
    if (!window.studio) return;
    let currentSave = true;
    setStorageStatus("saving");
    nativeCall("saveWorkspace", state).then(
      () => {
        if (currentSave) setStorageStatus("saved");
      },
      () => {
        if (currentSave) setStorageStatus("error");
      },
    );
    return () => {
      currentSave = false;
    };
  }, [state, retryStorage]);
  useEffect(() => {
    if (window.studio)
      nativeCall("getSettings")
        .then((s) => {
          setSettings(s);
          setDemo(!(s.hasKey && s.apiAvailable));
        })
        .catch((e) => setToast(e.message));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3800);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const fn = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommand((v) => !v);
      }
      if (e.key === "Escape") {
        setOpenedText(null);
        setModal(null);
        setCommand(false);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  const updateWorkspace = (updater) =>
    setState((prev) => ({
      ...prev,
      workspaces: {
        ...prev.workspaces,
        [current.id]:
          typeof updater === "function"
            ? updater(prev.workspaces[current.id] || blankWorkspace())
            : { ...prev.workspaces[current.id], ...updater },
      },
    }));
  const updateProject = (changes) =>
    setState((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === current.id ? { ...p, ...changes } : p,
      ),
    }));
  const navigate = (r) => {
    setRoute(r);
    setCommand(false);
  };
  const exportText = (name, text, kind = "text", deliver) => {
    setPasswordTask({
      mode: "encrypt",
      submit: async (password) => {
        const encrypted = await encryptPortable(
          JSON.stringify({ kind, name, text }),
          password,
        );
        if (deliver) {
          await deliver(encrypted);
        } else if (window.studio) {
          const result = await nativeCall("exportFile", encrypted);
          if (!result.canceled) setToast("加密文件已保存");
        } else {
          const url = URL.createObjectURL(
            new Blob([encrypted], { type: "application/json" }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = `漫序-加密文件-${uid().slice(0, 8)}${PORTABLE_EXTENSION}`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setToast("加密文件已导出");
        }
      },
    });
  };
  const openEncrypted = (envelope, onProject) => {
    setPasswordTask({
      mode: "decrypt",
      submit: async (password) => {
        let payload;
        try {
          payload = JSON.parse(await decryptPortable(envelope, password));
        } catch (err) {
          if (err instanceof SyntaxError)
            throw new Error("该文件的内容格式无法识别。");
          throw err;
        }
        if (typeof payload?.text !== "string")
          throw new Error("加密文件缺少内容。");
        if (payload.kind === "project") onProject(payload.text);
        else if (payload.kind === "text") setOpenedText(payload);
        else throw new Error("该文件的内容格式无法识别。");
      },
    });
  };
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast("已复制到剪贴板");
    } catch {
      setToast("复制失败，请选中文本后按 ⌘C。");
    }
  };
  const generate = async (payload, demoText) => {
    if (demo) {
      await new Promise((r) => setTimeout(r, 650));
      return { text: demoText };
    }
    if (!settings.hasKey) throw new Error("请先连接模型，或切换至演示模式。");
    if (!window.studio) throw new Error("真实模型调用需要打开 Mac App。");
    return nativeCall("generate", payload);
  };
  const ctx = {
    state,
    setState,
    current,
    workspace,
    updateWorkspace,
    updateProject,
    route,
    navigate,
    setToast,
    modal,
    setModal,
    demo,
    setDemo,
    settings,
    setSettings,
    generate,
    exportText,
    openEncrypted,
    copy,
  };
  return (
    <Context.Provider value={ctx}>
      <div className="app-shell">
        <aside className="sidebar">
          <div
            className={`traffic-lights ${window.studio ? "native" : ""}`}
            aria-hidden="true"
          >
            <i />
            <i />
            <i />
          </div>
          <button className="brand" onClick={() => navigate("home")}>
            <span className="brand-mark">
              <FilmStrip size={23} weight="bold" />
            </span>
            <span>
              漫序 <b>Studio</b>
              <small>把故事，一幕幕实现</small>
            </span>
          </button>
          <div className="workspace-label">
            个人创作空间 <CaretDown size={13} />
          </div>
          <nav>
            {nav.map(([id, label, Icon], i) => (
              <React.Fragment key={id}>
                {i === 2 && <div className="nav-caption">创作工具</div>}
                {i === 6 && <div className="nav-divider" />}
                <button
                  className={`nav-item ${route === id ? "active" : ""}`}
                  onClick={() => navigate(id)}
                >
                  <Icon
                    size={19}
                    weight={route === id ? "duotone" : "regular"}
                  />
                  <span>{label}</span>
                  {id === "learn" && <span className="nav-new">入门</span>}
                </button>
              </React.Fragment>
            ))}
          </nav>
          <button className="sidebar-tip" onClick={() => navigate("learn")}>
            <span className="tip-icon">
              <Lightbulb size={20} />
            </span>
            <strong>你的第一部漫剧</strong>
            <p>
              从一个想法开始，
              <br />
              跟着教程完成第一幕。
            </p>
            <span>
              开始学习 <ArrowUpRight size={14} />
            </span>
          </button>
          <div className="sidebar-bottom">
            <button
              className={`nav-item ${route === "settings" ? "active" : ""}`}
              onClick={() => navigate("settings")}
            >
              <Plugs size={19} />
              <span>管理后台</span>
              <span
                className={`connection-dot ${settings.hasKey ? "connected" : ""}`}
              />
            </button>
            <div className="profile">
              <span className="avatar">创</span>
              <div>
                独立创作者<small>本地工作空间</small>
              </div>
              <span className="version">v{appVersion}</span>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              创作空间 <CaretRight size={12} />
              <span>{nav.find((n) => n[0] === route)?.[1] || "管理后台"}</span>
            </div>
            <div className="topbar-right">
              <button
                className="search-trigger"
                onClick={() => setCommand(true)}
              >
                <MagnifyingGlass size={15} />
                <span>搜索功能与教程</span>
                <kbd>⌘ K</kbd>
              </button>
              <button
                className={`mode-pill ${!demo ? "live" : ""}`}
                onClick={() => setDemo(!demo)}
                title="切换本地演示和 API 模式"
              >
                <span />
                {demo ? "演示模式" : "API 模式"}
                <CaretDown size={11} />
              </button>
            </div>
          </header>
          <main className={`main-content page-${route}`}>
            <AnimatePresence mode="wait">
              <motion.div
                key={route}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {route === "home" ? (
                  <Home />
                ) : route === "projects" ? (
                  <Projects />
                ) : route === "prompts" ? (
                  <Prompts />
                ) : route === "characters" ? (
                  <Characters />
                ) : route === "storyboard" ? (
                  <Storyboard />
                ) : route === "analysis" ? (
                  <Analysis />
                ) : route === "learn" ? (
                  <Learn />
                ) : (
                  <AdminSettings
                    studio={ctx}
                    ui={{ PageHeading, Field, Button, nativeCall }}
                    Settings={Settings}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
          <footer className="app-footer">
            <span>
              <span
                className={`tiny-dot ${storageStatus === "error" ? "warning" : ""}`}
              />
              {!window.studio ? (
                "浏览器预览 · 本次编辑不会自动保存"
              ) : storageStatus === "error" ? (
                <>
                  加密保存失败，请先导出备份{" "}
                  <button
                    className="text-link"
                    onClick={() => setRetryStorage((n) => n + 1)}
                  >
                    重试
                  </button>
                </>
              ) : storageStatus === "saving" ? (
                "正在加密保存…"
              ) : (
                "创作数据已加密保存在这台 Mac 上"
              )}
            </span>
            <span>
              MANXU STUDIO <span className="footer-separator">/</span> MADE FOR
              YOUR NEXT STORY
            </span>
          </footer>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={19} />
          {toast}
        </div>
      )}
      {modal === "project" && <ProjectModal />}
      {command && <CommandPalette close={() => setCommand(false)} />}
      {passwordTask && (
        <ExportDialog
          key={passwordTask.mode}
          mode={passwordTask.mode}
          onSubmit={passwordTask.submit}
          onClose={() => setPasswordTask(null)}
        />
      )}
      {openedText && !passwordTask && (
        <div className="modal-overlay">
          <section
            className="modal decrypted-text-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="decrypted-title"
          >
            <div className="modal-head">
              <span className="tool-icon">
                <LockKey size={22} />
              </span>
              <IconButton
                icon={X}
                label="关闭"
                onClick={() => setOpenedText(null)}
              />
            </div>
            <h2 id="decrypted-title">{openedText.name || "已解密的文档"}</h2>
            <Field label="本次打开期间可见">
              <textarea readOnly rows={12} value={openedText.text} />
            </Field>
            <Button icon={Copy} onClick={() => copy(openedText.text)}>
              复制到系统剪贴板
            </Button>
          </section>
        </div>
      )}
    </Context.Provider>
  );
}
function Home() {
  const { current, workspace, navigate, setModal, state } = useStudio();
  const progress = state.completed?.length || 0;
  return (
    <>
      <PageHeading
        eyebrow="YOUR CREATIVE WORKSPACE"
        title="开始你的下一幕。"
        description="从灵感到分镜，和 AI 一起把故事讲出来。"
      >
        <Button kind="primary" icon={Plus} onClick={() => setModal("project")}>
          新建漫剧项目
        </Button>
      </PageHeading>
      <div className="home-feature-grid">
        <section className="project-feature">
          <div className="project-visual">
            <div className="feature-images">
              {initialShots.slice(0, 3).map((s, i) => (
                <img
                  key={s.id}
                  src={asset(s.image)}
                  alt={s.title}
                  style={{
                    objectPosition:
                      i === 0 ? "50% 39%" : i === 1 ? "52% 42%" : "50% 27%",
                  }}
                />
              ))}
            </div>
            <div className="visual-shade" />
            <div className="feature-label">
              <span className="outline-pill">
                <span />{" "}
                {current.id === initialProject.id
                  ? "本地示例项目"
                  : "当前创作项目"}
              </span>
              <h2>{current.name}</h2>
              <p>{current.summary || "从一句话，写出一个值得被看见的故事。"}</p>
              <div className="feature-meta">
                {current.genre} <i /> {current.ratio} 竖屏 <i />{" "}
                {current.duration} 秒
              </div>
            </div>
            <span className="visual-corner">A STORY IN THE MAKING</span>
          </div>
          <div className="feature-bottom">
            <div className="project-mini-meta">
              <span className="small-icon">
                <FilmStrip size={18} />
              </span>
              <div>
                <strong>让故事继续发生</strong>
                <small>
                  {workspace.roles.length} 张角色卡 <span>·</span>{" "}
                  {workspace.shots.length} 个分镜
                </small>
              </div>
            </div>
            <Button kind="dark" onClick={() => navigate("storyboard")}>
              进入项目 <ArrowRight size={15} />
            </Button>
          </div>
        </section>
        <section className="learning-feature">
          <div className="section-tag">FIRST STORY, FIRST STEP</div>
          <div className="lesson-art">
            <span className="art-frame frame-one" />
            <span className="art-frame frame-two" />
            <span className="art-play">
              <Play size={23} weight="fill" />
            </span>
            <span className="art-line one" />
            <span className="art-line two" />
            <span className="art-spark">✦</span>
          </div>
          <Badge orange>新手创作指南</Badge>
          <h2>
            第一部漫剧，
            <br />
            从这里开始。
          </h2>
          <p>
            不必先学会所有工具。
            <br />
            跟着 6 个小节，完成一个 15 秒故事。
          </p>
          <div className="learning-progress">
            <div>
              <span>学习进度</span>
              <b>{progress} / 6</b>
            </div>
            <div className="progress-track">
              <span style={{ width: `${(progress / 6) * 100}%` }} />
            </div>
          </div>
          <button className="text-link" onClick={() => navigate("learn")}>
            继续学习 <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <div className="section-heading">
        <h2>灵感，随时开工</h2>
        <span>四个创作入口，让下一步更清晰</span>
      </div>
      <div className="quick-tools">
        {[
          [
            "prompts",
            MagicWand,
            "把想法写成提示词",
            "从一句灵感，到可执行的画面。",
            "01",
          ],
          [
            "characters",
            IdentificationCard,
            "让角色保持一致",
            "锁定外貌、服装与人物性格。",
            "02",
          ],
          [
            "analysis",
            MonitorPlay,
            "拆解一部好作品",
            "看懂镜头，也看懂制作方法。",
            "03",
          ],
          [
            "storyboard",
            FilmStrip,
            "把故事排成分镜",
            "让每个镜头，都有它的作用。",
            "04",
          ],
        ].map(([r, Icon, title, desc, n]) => (
          <button key={r} className="quick-tool" onClick={() => navigate(r)}>
            <div>
              <span className={`tool-icon ${r}`}>
                <Icon size={23} weight="duotone" />
              </span>
              <span className="tool-number">{n}</span>
            </div>
            <h3>{title}</h3>
            <p>{desc}</p>
            <ArrowUpRight size={17} className="tool-arrow" />
          </button>
        ))}
      </div>
      <div className="home-bottom-note">
        <span className="note-icon">
          <LockKey size={18} />
        </span>
        <div>
          <strong>灵感属于你，创作也属于你。</strong>
          <span>
            {window.studio
              ? "项目加密保存在本机。连接 API 后再开始真实生成。"
              : "浏览器预览不自动保存，请使用加密导出保留你的创作。"}
          </span>
        </div>
        <button onClick={() => navigate("settings")}>
          配置模型 <ArrowUpRight size={15} />
        </button>
      </div>
    </>
  );
}
function ProjectModal() {
  const { setModal, setState, navigate } = useStudio();
  const [name, setName] = useState(""),
    [summary, setSummary] = useState(""),
    [genre, setGenre] = useState("都市悬疑"),
    [ratio, setRatio] = useState("9:16"),
    [duration, setDuration] = useState("15"),
    [error, setError] = useState("");
  function create(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError("给你的故事起个名字。");
      return;
    }
    const id = uid();
    setState((s) => ({
      ...s,
      activeId: id,
      projects: [
        ...s.projects,
        {
          id,
          name: name.trim(),
          summary,
          genre,
          ratio,
          duration,
          updated: "刚刚创建",
        },
      ],
      workspaces: { ...s.workspaces, [id]: blankWorkspace() },
    }));
    setModal(null);
    navigate("characters");
  }
  return (
    <div className="modal-overlay" onClick={() => setModal(null)}>
      <form
        className="modal"
        onSubmit={create}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="tool-icon">
            <FilmStrip size={24} />
          </span>
          <IconButton icon={X} label="关闭" onClick={() => setModal(null)} />
        </div>
        <div className="eyebrow">A NEW STORY STARTS HERE</div>
        <h2>给下一幕，起个名字。</h2>
        <p>先确定一个方向，细节可以在创作中慢慢完善。</p>
        <Field label="项目名称">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="例如：雨停之前"
          />
        </Field>
        <Field label="一句话故事">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="谁，在什么地方，遇见了什么异常？"
            rows={3}
          />
        </Field>
        <div className="form-grid">
          <Field label="故事类型">
            <select value={genre} onChange={(e) => setGenre(e.target.value)}>
              {[
                "都市悬疑",
                "写实微恐",
                "东方奇幻",
                "治愈日常",
                "热血冒险",
                "浪漫爱情",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="画幅">
            <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
              <option>9:16</option>
              <option>16:9</option>
              <option>1:1</option>
            </select>
          </Field>
          <Field label="目标时长（秒）">
            <input
              type="number"
              min="5"
              max="600"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <Button kind="primary" className="full-width" type="submit" icon={Plus}>
          创建项目，开始设定角色
        </Button>
      </form>
    </div>
  );
}
function Projects() {
  const {
    state,
    setState,
    current,
    workspace,
    navigate,
    setModal,
    exportText,
    openEncrypted,
    setToast,
  } = useStudio();
  const file = useRef();
  const [query, setQuery] = useState("");
  const { settings } = useStudio();
  function exportProject(deliver) {
    const project = {
      schema: 1, projects: [current], roles: workspace.roles, shots: workspace.shots,
      prompt: workspace.prompt, history: workspace.history, referenceReport: workspace.referenceReport,
    };
    exportText(current.name + ".json", JSON.stringify(project, null, 2), "project", deliver);
  }
  function addImportedProject(text) {
    const d = validateProject(JSON.parse(text));
    const source = d.projects[0];
    if (!source) throw new Error("文件中没有项目。");
    const id = uid();
    setState((s) => ({
      ...s,
      activeId: id,
      projects: [
        ...s.projects,
        { ...source, id, name: source.name + " · 导入" },
      ],
      workspaces: {
        ...s.workspaces,
        [id]: {
          roles: d.roles,
          shots: d.shots,
          prompt: d.prompt,
          history: d.history,
          referenceReport: d.referenceReport,
        },
      },
    }));
    setToast("项目已导入");
  }
  async function importProject(e) {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      if (f.size > MAX_PORTABLE_BYTES)
        throw new Error("文件超出导入大小上限。");
      const text = await f.text();
      if (f.name.toLowerCase().endsWith(PORTABLE_EXTENSION))
        openEncrypted(text, addImportedProject);
      else addImportedProject(text); // Former plaintext JSON backups remain readable.
    } catch (err) {
      setToast(err.message);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="YOUR STORIES"
        title="项目空间"
        description="每个故事都有自己的角色、提示词和分镜。"
      >
        <Button icon={UploadSimple} onClick={() => file.current.click()}>
          打开文件 / 导入项目
        </Button>
        <Button kind="primary" icon={Plus} onClick={() => setModal("project")}>
          新建项目
        </Button>
      </PageHeading>
      <input
        hidden
        ref={file}
        type="file"
        accept=".json,.manxu"
        onChange={importProject}
      />
      <div className="toolbar">
        <div className="tabs">
          <button className="active">
            全部项目 <span>{state.projects.length}</span>
          </button>
        </div>
        <label className="search-field">
          <MagnifyingGlass size={17} />
          <input
            placeholder="搜索故事名称"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="project-grid">
        {state.projects
          .filter((p) => p.name.includes(query))
          .map((p, i) => (
            <button
              className={`project-card ${p.id === current.id ? "selected" : ""}`}
              key={p.id}
              onClick={() => setState((s) => ({ ...s, activeId: p.id }))}
            >
              <div className={`project-cover cover-${i % 3}`}>
                {p.id === initialProject.id ? (
                  <img src={asset("shot-1.png")} alt="示例分镜" />
                ) : (
                  <>
                    <FilmStrip size={58} weight="thin" />
                    <span>{p.genre}</span>
                  </>
                )}
                {p.id === current.id && (
                  <span className="selected-label">
                    <Check size={12} /> 当前项目
                  </span>
                )}
              </div>
              <div className="project-card-body">
                <h3>
                  {p.name}
                  <ArrowUpRight size={16} />
                </h3>
                <p>{p.summary || "一个等待被展开的故事"}</p>
                <div>
                  <span>
                    {p.genre} · {p.duration}s
                  </span>
                  <span>{p.ratio}</span>
                </div>
              </div>
            </button>
          ))}
        <button
          className="new-project-tile"
          onClick={() => setModal("project")}
        >
          <span>
            <Plus size={26} />
          </span>
          <strong>开始一个新故事</strong>
          <small>下一幕，由你创造</small>
        </button>
      </div>
      <section className="selected-project-strip">
        <div>
          <Badge orange>当前项目</Badge>
          <h2>{current.name}</h2>
          <p>
            {workspace.roles.length} 张角色卡 / {workspace.shots.length} 个分镜
            / {workspace.history.length} 个提示词版本
          </p>
        </div>
        <div>
          <Button
            icon={Download}
            onClick={() => exportProject()}
          >
            加密导出备份
          </Button>
          <Button kind="dark" onClick={() => navigate("prompts")}>
            进入创作 <ArrowRight size={16} />
          </Button>
        </div>
      </section>
      {settings.cloudBackups && (
        <CloudBackups exportProject={exportProject} openBackup={(data) => openEncrypted(data, addImportedProject)} />
      )}
    </>
  );
}
function CloudBackups({ exportProject, openBackup }) {
  const { setToast } = useStudio();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load(id) {
    setBusy(true);
    setError("");
    try {
      if (id) openBackup(await nativeCall("downloadBackup", id));
      else setRows(await nativeCall("listBackups"));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  function upload() {
    exportProject(async (ciphertext) => {
      const record = await nativeCall("uploadBackup", ciphertext);
      setRows((previous) => previous && [record, ...previous.filter((row) => row.id !== record.id)]);
      setToast("已将加密项目上传至腾讯云");
    });
  }
  return (
    <section className="settings-form">
      <div className="panel-title"><h2>腾讯云备份</h2></div>
      <div className="settings-fields">
        <p>用独立文件密码在本机加密当前项目。云端列表按时间和大小识别备份。</p>
        <div className="settings-actions">
          <Button onClick={upload} disabled={busy}>加密并上传当前项目</Button>
          <Button onClick={() => load()} disabled={busy}>{busy ? "正在读取…" : "查看云端备份"}</Button>
        </div>
        {error && <p role="alert" className="inline-error">{error}</p>}
        {rows?.length === 0 && <p>尚无云端备份。</p>}
        {rows?.map((row) => (
          <div className="settings-actions" key={row.id}>
            <span>{new Date(row.createdAt).toLocaleString("zh-CN")} · {Math.ceil(row.size / 1024)} KB · {row.id.slice(0, 8)}</span>
            <Button onClick={() => load(row.id)} disabled={busy}>解锁并导入</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
function Prompts() {
  const {
    workspace,
    current,
    updateWorkspace,
    generate,
    demo,
    copy,
    exportText,
    navigate,
    setToast,
  } = useStudio();
  const [idea, setIdea] = useState(workspace.prompt),
    [mode, setMode] = useState(workspace.history[0]?.mode || "视频提示词"),
    [style, setStyle] = useState("写实电影感"),
    [roleId, setRoleId] = useState(workspace.roles[0]?.id || ""),
    [instruction, setInstruction] = useState(""),
    [output, setOutput] = useState(workspace.history[0]?.text || ""),
    [outputDemo, setOutputDemo] = useState(workspace.history[0]?.demo ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [showHistory, setShowHistory] = useState(false);
  const role = workspace.roles.find((r) => r.id === roleId);
  const params = {
    idea,
    role,
    style,
    ratio: current.ratio,
    duration: current.duration,
    mode,
    instruction,
    previous: output,
  };
  async function run() {
    if (!idea.trim()) {
      setError("先写下你的故事想法。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await generate(
        { prompt: buildPrompt(params) },
        demoPrompt(params),
      );
      setOutput(r.text);
      setOutputDemo(demo);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function save() {
    if (!output) return;
    updateWorkspace((w) => ({
      ...w,
      prompt: idea,
      history: [
        {
          id: uid(),
          text: output,
          date: new Date().toLocaleString("zh-CN"),
          mode,
          demo: outputDemo,
        },
        ...w.history,
      ].slice(0, 30),
    }));
    setToast("已保存为新的提示词版本");
  }
  return (
    <>
      <PageHeading
        eyebrow="PROMPT WORKSHOP"
        title="让想法，变成画面。"
        description="说出你的想法，AI 帮你补齐主体、镜头与动作。"
      >
        <Button icon={Clock} onClick={() => setShowHistory(!showHistory)}>
          版本记录 <span className="count">{workspace.history.length}</span>
        </Button>
      </PageHeading>
      <div className="project-context">
        <FolderSimple size={16} />
        {current.name}
        <CaretRight size={12} />
        <span>提示词工坊</span>
        <Badge orange>{demo ? "本地结构化演示" : "使用已连接模型"}</Badge>
      </div>
      {showHistory && (
        <div className="history-panel">
          <div className="panel-title">
            <h3>已保存的版本</h3>
            <IconButton
              icon={X}
              label="关闭版本记录"
              onClick={() => setShowHistory(false)}
            />
          </div>
          {workspace.history.length ? (
            workspace.history.map((h, i) => (
              <button
                key={h.id}
                onClick={() => {
                  setOutput(h.text);
                  setMode(h.mode);
                  setOutputDemo(h.demo);
                  setShowHistory(false);
                }}
              >
                <span>
                  V{workspace.history.length - i} · {h.mode}{" "}
                  {h.demo ? "· 演示" : ""}
                </span>
                <small>{h.date}</small>
                <p>{h.text.slice(0, 80)}</p>
              </button>
            ))
          ) : (
            <p>还没有版本。生成或编辑结果后，点击「保存版本」。</p>
          )}
        </div>
      )}
      <div className="editor-layout">
        <section className="editor-main">
          <div className="panel-title">
            <h2>
              <MagicWand size={20} /> 提示词编辑器
            </h2>
            <span className="subtle">所有好画面，都始于一个想法</span>
          </div>
          <div className="tabs prompt-tabs">
            {["视频提示词", "图像提示词", "角色设定", "镜头优化"].map((m) => (
              <button
                className={mode === m ? "active" : ""}
                key={m}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="editor-form">
            <Field
              label="你想拍一个怎样的故事？"
              helper="像和导演聊天一样描述即可，不需要一开始就写专业术语。"
            >
              <textarea
                className="idea-input"
                rows={6}
                value={idea}
                onChange={(e) => {
                  setIdea(e.target.value);
                  updateWorkspace({ prompt: e.target.value });
                }}
                placeholder="例如：邮差在海边收到一封来自明天的信……"
              />
            </Field>
            <div className="form-grid">
              <Field label="画面风格">
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                >
                  {[
                    "写实电影感",
                    "日系动画",
                    "国风水墨",
                    "3D 动画",
                    "复古胶片",
                    "治愈手绘",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="关联角色">
                <select
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                >
                  <option value="">不关联角色</option>
                  {workspace.roles.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.name} · {r.tag}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="画幅 / 时长">
                <input
                  value={`${current.ratio} / ${current.duration}s`}
                  readOnly
                />
              </Field>
            </div>
            <Field label="这次想重点调整什么？（可选）">
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="例如：情绪更克制，强调拿信与抬头的动作关系"
              />
            </Field>
            <div className="suggestion-chips">
              {["强化角色一致性", "补充镜头语言", "减少动作冲突"].map((t) => (
                <button
                  key={t}
                  onClick={() => setInstruction((v) => (v ? v + "；" + t : t))}
                >
                  <Plus size={12} />
                  {t}
                </button>
              ))}
            </div>
            {error && (
              <div className="inline-error" role="alert">
                <WarningCircle size={16} />
                {error}
              </div>
            )}
            <div className="generate-row">
              <span>
                {demo
                  ? "演示模式不调用 API，也不产生费用"
                  : "将以上文字和关联角色设定发送至模型"}
              </span>
              <Button
                kind="primary"
                icon={busy ? ArrowClockwise : MagicWand}
                disabled={busy}
                onClick={run}
              >
                {busy
                  ? "正在整理画面…"
                  : output
                    ? "重新优化提示词"
                    : "生成提示词"}
              </Button>
            </div>
          </div>
          <div className="output-section">
            <div className="panel-title">
              <h3>
                创作结果 {output && <Badge>{outputDemo ? "模板演示" : "AI 生成"}</Badge>}
              </h3>
              <div className="button-row">
                <IconButton
                  icon={Copy}
                  label="复制结果"
                  disabled={!output}
                  onClick={() => copy(output)}
                />
                <IconButton
                  icon={Download}
                  label="导出提示词"
                  disabled={!output}
                  onClick={() =>
                    exportText(`${current.name}-提示词.txt`, output)
                  }
                />
              </div>
            </div>
            {busy ? (
              <div className="skeleton-output">
                <i />
                <i />
                <i />
                <i />
              </div>
            ) : output ? (
              <textarea
                aria-label="编辑生成的提示词"
                className="output-textarea"
                value={output}
                onChange={(e) => setOutput(e.target.value)}
              />
            ) : (
              <div className="output-empty">
                <span>
                  <MagicWand size={26} weight="thin" />
                </span>
                <h3>给你的灵感，一个更清晰的表达。</h3>
                <p>生成的提示词会出现在这里，你可以继续编辑和保存版本。</p>
              </div>
            )}
            {output && (
              <div className="output-footer">
                <span>可以直接编辑，保留你自己的创作判断。</span>
                <Button icon={FloppyDisk} onClick={save}>
                  保存版本
                </Button>
              </div>
            )}
          </div>
        </section>
        <aside className="context-panel">
          <div className="panel-title">
            <h3>创作上下文</h3>
            <SlidersHorizontal size={17} />
          </div>
          {role ? (
            <>
              <div className="context-portrait">
                <img
                  src={
                    role.image?.startsWith("data:")
                      ? role.image
                      : asset(role.image || "portrait.png")
                  }
                  alt={role.name}
                />
                <div>
                  <Badge>已关联角色</Badge>
                  <h3>{role.name}</h3>
                  <span>
                    {role.tag} / {role.age} 岁
                  </span>
                </div>
              </div>
              <div className="context-section">
                <h4>
                  <LockKey size={15} /> 角色锁定特征
                </h4>
                <p>{role.locked}</p>
                <button
                  className="text-link"
                  onClick={() => navigate("characters")}
                >
                  编辑角色卡 <ArrowUpRight size={14} />
                </button>
              </div>
            </>
          ) : (
            <div className="context-section">
              <IdentificationCard size={30} />
              <h3>先认识你的角色</h3>
              <p>关联角色卡后，每次生成都会带入固定的外貌、服装与约束。</p>
              <Button onClick={() => navigate("characters")}>创建角色卡</Button>
            </div>
          )}
          <div className="director-note">
            <Lightbulb size={20} />
            <h4>导演小提醒</h4>
            <p>
              “害怕”是情绪，
              <br />
              “手停在半空，呼吸变轻”
              <br />
              才是能被拍出来的动作。
            </p>
          </div>
          <div className="context-section">
            <span className="eyebrow">A GOOD PROMPT</span>
            <ol className="prompt-checklist">
              {[
                "谁，在什么地方",
                "按顺序发生的动作",
                "景别、运镜与声音",
                "必须保持的细节",
              ].map((t) => (
                <li key={t}>
                  <CheckCircle size={15} />
                  {t}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
function Characters() {
  const {
    workspace,
    updateWorkspace,
    generate,
    setToast,
    demo,
    copy,
    exportText,
    current,
  } = useStudio();
  const [selected, setSelected] = useState(workspace.roles[0]?.id),
    [draft, setDraft] = useState(workspace.roles[0] || null),
    [tab, setTab] = useState("角色设定"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const upload = useRef();
  const change = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  function choose(r) {
    setSelected(r.id);
    setDraft({ ...r });
    setError("");
  }
  function add() {
    const r = {
      id: uid(),
      name: "新角色",
      tag: "主角",
      age: "24",
      personality: "",
      description: "",
      appearance: "",
      locked: "",
      negative: "",
      image: "",
    };
    setSelected(r.id);
    setDraft(r);
    setError("");
  }
  function save() {
    if (!draft.name.trim()) {
      setError("角色需要一个名字。");
      return;
    }
    updateWorkspace((w) => ({
      ...w,
      roles: w.roles.some((r) => r.id === draft.id)
        ? w.roles.map((r) => (r.id === draft.id ? draft : r))
        : [...w.roles, draft],
    }));
    setToast("角色卡已保存");
  }
  async function picture(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
      f.size > 4e6
    ) {
      setError("请选择 4 MB 以内的 PNG、JPG 或 WebP 图片。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => change("image", reader.result);
    reader.readAsDataURL(f);
    e.target.value = "";
  }
  async function enrich() {
    setBusy(true);
    setError("");
    const fallback = JSON.stringify({
      ...draft,
      description:
        draft.description ||
        `${draft.name}是故事中的${draft.tag}。在事件中通过具体的选择推动故事。`,
      personality: draft.personality || "谨慎、敏感，有明确的行动动机",
      locked:
        draft.locked ||
        draft.appearance ||
        "请补充五官、发型、服装和固定道具。",
    });
    try {
      const r = await generate(
        {
          json: true,
          prompt: `根据以下角色设定补充人物卡，保持原有外貌与用户输入。仅输出 JSON，字段为 name,tag,age,personality,description,appearance,locked,negative，所有字段值为字符串。设定：${JSON.stringify(Object.fromEntries(["name", "tag", "age", "personality", "description", "appearance", "locked", "negative"].map((key) => [key, draft[key]])))}`,
        },
        fallback,
      );
      const match = r.text.match(/\{[\s\S]*\}/);
      const data = JSON.parse(match?.[0] || r.text);
      setDraft((d) => ({
        ...d,
        ...Object.fromEntries(
          [
            "name",
            "tag",
            "age",
            "personality",
            "description",
            "appearance",
            "locked",
            "negative",
          ]
            .filter((k) => typeof data[k] === "string")
            .map((k) => [k, data[k]]),
        ),
      }));
      setToast(
        demo ? "已补充演示设定，请检查后保存" : "AI 已补充设定，请检查后保存",
      );
    } catch (e) {
      setError("角色设定未能生成：" + e.message);
    } finally {
      setBusy(false);
    }
  }
  const cardPrompt = draft
    ? `${draft.name}，${draft.age}岁。${draft.appearance}\n性格：${draft.personality}\n固定特征：${draft.locked}\n负向约束：${draft.negative}`
    : "";
  return (
    <>
      <PageHeading
        eyebrow="CHARACTER BIBLE"
        title="让每个角色，都有自己的样子。"
        description="不只是人物介绍，也是每个镜头共用的一致性依据。"
      >
        <Button kind="primary" icon={Plus} onClick={add}>
          新建角色卡
        </Button>
      </PageHeading>
      <div className="project-context">
        <FolderSimple size={16} />
        {current.name}
        <CaretRight size={12} />
        <span>角色卡片</span>
        <span className="ml-auto">{workspace.roles.length} 个角色已保存</span>
      </div>
      <div className="character-layout">
        <aside className="character-list">
          {workspace.roles.map((r) => (
            <button
              className={selected === r.id ? "active" : ""}
              key={r.id}
              onClick={() => choose(r)}
            >
              {r.image ? (
                <img
                  src={r.image.startsWith("data:") ? r.image : asset(r.image)}
                  alt=""
                />
              ) : (
                <span className="role-initial">{r.name.slice(0, 1)}</span>
              )}
              <span>
                <strong>{r.name}</strong>
                <small>{r.tag}</small>
              </span>
              <CaretRight size={14} />
            </button>
          ))}
          <button className="add-character" onClick={add}>
            <Plus size={18} /> 添加新角色
          </button>
          <div className="list-note">
            <LockKey size={16} />
            <p>
              把外貌与道具写具体，
              <br />
              让角色跨镜头保持一致。
            </p>
          </div>
        </aside>
        {draft ? (
          <section className="character-editor">
            <div className="character-preview">
              <div className="character-photo">
                {draft.image ? (
                  <img
                    src={
                      draft.image.startsWith("data:")
                        ? draft.image
                        : asset(draft.image)
                    }
                    alt={draft.name}
                  />
                ) : (
                  <div className="portrait-placeholder">
                    <IdentificationCard size={65} weight="thin" />
                    <span>上传角色参考图</span>
                  </div>
                )}
                <button
                  className="image-upload"
                  onClick={() => upload.current.click()}
                >
                  <UploadSimple size={15} />
                  {draft.image ? "更换参考图" : "上传参考图"}
                </button>
                <input
                  hidden
                  ref={upload}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={picture}
                />
                <div className="photo-caption">
                  <span>
                    CHARACTER /{" "}
                    {String(
                      workspace.roles.findIndex((r) => r.id === draft.id) + 1 ||
                        workspace.roles.length + 1,
                    ).padStart(2, "0")}
                  </span>
                  <h2>{draft.name}</h2>
                  <p>
                    {draft.tag} · {draft.age} 岁
                  </p>
                </div>
              </div>
              <div className="image-caption">
                <ImageSquare size={15} />
                <span>正脸参考图 · 用于锁定人物身份</span>
              </div>
              <div className="character-lock-note">
                <LockKey size={17} />
                <div>
                  <strong>把“同一个人”写进每个镜头</strong>
                  <p>提示词工坊会读取这张卡片中的固定特征。</p>
                </div>
              </div>
            </div>
            <div className="character-fields">
              <div className="panel-title">
                <h2>人物档案</h2>
                <Badge orange>可编辑</Badge>
              </div>
              <div className="tabs">
                {["角色设定", "一致性规则", "出图提示词"].map((t) => (
                  <button
                    className={tab === t ? "active" : ""}
                    key={t}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="character-form">
                {tab === "角色设定" ? (
                  <>
                    <div className="form-grid two">
                      <Field label="角色姓名">
                        <input
                          value={draft.name}
                          onChange={(e) => change("name", e.target.value)}
                          maxLength={40}
                        />
                      </Field>
                      <Field label="角色定位">
                        <input
                          value={draft.tag}
                          onChange={(e) => change("tag", e.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="form-grid two">
                      <Field label="年龄">
                        <input
                          value={draft.age}
                          onChange={(e) => change("age", e.target.value)}
                          maxLength={10}
                        />
                      </Field>
                      <Field label="性格关键词">
                        <input
                          value={draft.personality}
                          onChange={(e) =>
                            change("personality", e.target.value)
                          }
                          placeholder="例如：克制、敏感、独立"
                        />
                      </Field>
                    </div>
                    <Field label="人物背景与动机">
                      <textarea
                        rows={3}
                        value={draft.description}
                        onChange={(e) => change("description", e.target.value)}
                        placeholder="她是谁？她想要什么？什么事情改变了她？"
                      />
                    </Field>
                    <Field label="外貌与服装">
                      <textarea
                        rows={3}
                        value={draft.appearance}
                        onChange={(e) => change("appearance", e.target.value)}
                        placeholder="五官、发型、服装、固定道具……"
                      />
                    </Field>
                  </>
                ) : tab === "一致性规则" ? (
                  <>
                    <div className="info-banner">
                      <LockKey size={19} />
                      <p>
                        这些字段会自动进入关联的提示词。具体的可见特征，更方便生成后核验。
                      </p>
                    </div>
                    <Field label="必须锁定的特征">
                      <textarea
                        rows={5}
                        value={draft.locked}
                        onChange={(e) => change("locked", e.target.value)}
                        placeholder="例如：同一五官、黑色长直发、白色卷袖、包不换手"
                      />
                    </Field>
                    <Field label="负向约束 / 避免出现">
                      <textarea
                        rows={4}
                        value={draft.negative}
                        onChange={(e) => change("negative", e.target.value)}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <div className="info-banner">
                      <MagicWand size={19} />
                      <p>
                        根据当前角色卡整理的基础提示词，可复制到图像工具。此版本暂不直接生成图片。
                      </p>
                    </div>
                    <div className="character-prompt">{cardPrompt}</div>
                    <Button icon={Copy} onClick={() => copy(cardPrompt)}>
                      复制角色提示词
                    </Button>
                    <Button
                      icon={Download}
                      onClick={() =>
                        exportText(`${draft.name}-角色卡.txt`, cardPrompt)
                      }
                    >
                      导出角色卡
                    </Button>
                  </>
                )}
                {error && (
                  <div className="inline-error" role="alert">
                    {error}
                  </div>
                )}
                <div className="character-form-footer">
                  <Button
                    icon={MagicWand}
                    disabled={busy}
                    onClick={enrich}
                    title={
                      demo
                        ? "使用本地模板补充"
                        : "仅发送角色设定文字，不发送参考图"
                    }
                  >
                    {busy ? "正在补充…" : "AI 完善设定"}
                  </Button>
                  <Button kind="primary" icon={FloppyDisk} onClick={save}>
                    保存角色卡
                  </Button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <Empty
            icon={IdentificationCard}
            title="故事，从认识一个人开始。"
            text="创建角色卡，记录外貌、性格和需要保持一致的特征。"
            action="创建第一个角色"
            onClick={add}
          />
        )}
      </div>
    </>
  );
}
function Empty({ icon: Icon, title, text, action, onClick }) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={42} weight="thin" />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <Button kind="primary" icon={Plus} onClick={onClick}>
          {action}
        </Button>
      )}
    </div>
  );
}
function Storyboard() {
  const {
    workspace,
    current,
    updateWorkspace,
    exportText,
    setToast,
    navigate,
  } = useStudio();
  const [selected, setSelected] = useState(workspace.shots[0]?.id),
    [play, setPlay] = useState(false);
  const shot =
    workspace.shots.find((s) => s.id === selected) || workspace.shots[0];
  const total = workspace.shots.reduce(
    (a, b) => a + Number(b.duration || 0),
    0,
  );
  function change(key, value) {
    updateWorkspace((w) => ({
      ...w,
      shots: w.shots.map((s) =>
        s.id === shot.id ? { ...s, [key]: value } : s,
      ),
    }));
  }
  function add() {
    const id = uid();
    updateWorkspace((w) => ({
      ...w,
      shots: [
        ...w.shots,
        {
          id,
          number: String(w.shots.length + 1).padStart(2, "0"),
          title: "新镜头",
          duration: 3,
          scale: "中景",
          movement: "固定机位",
          action: "",
          audio: "",
          image: "",
        },
      ],
    }));
    setSelected(id);
  }
  function remove() {
    updateWorkspace((w) => ({
      ...w,
      shots: w.shots.filter((s) => s.id !== shot.id),
    }));
    setSelected(null);
    setToast("已移除此镜头");
  }
  function move(direction) {
    const i = workspace.shots.findIndex((s) => s.id === shot.id);
    const j = i + direction;
    if (j < 0 || j >= workspace.shots.length) return;
    const shots = [...workspace.shots];
    [shots[i], shots[j]] = [shots[j], shots[i]];
    updateWorkspace({
      shots: shots.map((s, k) => ({
        ...s,
        number: String(k + 1).padStart(2, "0"),
      })),
    });
  }
  const script = workspace.shots
    .map(
      (s) =>
        `镜${s.number} · ${s.title} / ${s.duration}s\n${s.scale}，${s.movement}\n画面：${s.action}\n声音：${s.audio}`,
    )
    .join("\n\n");
  return (
    <>
      <PageHeading
        eyebrow="STORYBOARD"
        title="每一幕，都推动故事。"
        description="把空间、动作和声音排在一起，看清镜头之间的因果。"
      >
        <Button
          icon={Download}
          disabled={!workspace.shots.length}
          onClick={() => exportText(`${current.name}-分镜脚本.txt`, script)}
        >
          导出分镜
        </Button>
        <Button kind="primary" icon={Plus} onClick={add}>
          添加镜头
        </Button>
      </PageHeading>
      <div className="project-context">
        <FolderSimple size={16} />
        {current.name}
        <Badge>{current.ratio}</Badge>
        <span className="ml-auto">
          {workspace.shots.length} 个镜头 <span className="sep">/</span> 计划{" "}
          {total}s <span className="sep">/</span> 目标 {current.duration}s
        </span>
      </div>
      {workspace.shots.length ? (
        <>
          <div className="storyboard-strip">
            {workspace.shots.map((s) => (
              <button
                className={`shot-card ${shot?.id === s.id ? "active" : ""}`}
                key={s.id}
                onClick={() => setSelected(s.id)}
              >
                <div className="shot-frame">
                  {s.image ? (
                    <img
                      src={
                        s.image.startsWith("data:") ? s.image : asset(s.image)
                      }
                      alt={s.title}
                    />
                  ) : (
                    <FilmStrip size={40} weight="thin" />
                  )}
                  <span className="shot-number">{s.number}</span>
                  <span className="shot-duration">{s.duration}s</span>
                </div>
                <div className="shot-card-caption">
                  <strong>{s.title}</strong>
                  <span>
                    {s.scale}
                    <CaretRight size={13} />
                  </span>
                </div>
              </button>
            ))}
          </div>
          {shot && (
            <div className="shot-detail">
              <div className="shot-preview">
                {shot.image ? (
                  <img
                    src={
                      shot.image.startsWith("data:")
                        ? shot.image
                        : asset(shot.image)
                    }
                    alt={shot.title}
                  />
                ) : (
                  <Empty
                    icon={FilmStrip}
                    title="为这个镜头写下画面"
                    text="先明确动作，再准备参考图。"
                  />
                )}
                <span className="preview-label">
                  镜 {shot.number} · {shot.scale}
                </span>
              </div>
              <div className="shot-fields">
                <div className="panel-title">
                  <h2>镜 {shot.number} · 镜头详情</h2>
                  <div className="button-row">
                    <IconButton
                      icon={ArrowLeft}
                      label="镜头前移"
                      onClick={() => move(-1)}
                    />
                    <IconButton
                      icon={ArrowRight}
                      label="镜头后移"
                      onClick={() => move(1)}
                    />
                    <IconButton
                      icon={Trash}
                      label="移除镜头"
                      onClick={remove}
                    />
                  </div>
                </div>
                <Field label="镜头名称">
                  <input
                    value={shot.title}
                    onChange={(e) => change("title", e.target.value)}
                  />
                </Field>
                <div className="form-grid">
                  <Field label="景别">
                    <select
                      value={shot.scale}
                      onChange={(e) => change("scale", e.target.value)}
                    >
                      {["远景", "全景", "中景", "中近景", "近景", "特写"].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field label="运镜">
                    <input
                      value={shot.movement}
                      onChange={(e) => change("movement", e.target.value)}
                    />
                  </Field>
                  <Field label="时长（秒）">
                    <input
                      type="number"
                      min="1"
                      max="120"
                      value={shot.duration}
                      onChange={(e) =>
                        change("duration", Number(e.target.value))
                      }
                    />
                  </Field>
                </div>
                <Field label="画面与动作">
                  <textarea
                    rows={3}
                    value={shot.action}
                    onChange={(e) => change("action", e.target.value)}
                  />
                </Field>
                <Field label="声音与对白">
                  <textarea
                    rows={2}
                    value={shot.audio}
                    onChange={(e) => change("audio", e.target.value)}
                  />
                </Field>
                <div className="info-banner">
                  <CheckCircle size={18} />
                  <p>
                    所有修改自动保存在当前项目。分镜是计划，实际切镜需在成片后重新核验。
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <Empty
          icon={FilmStrip}
          title="先安排故事的第一个镜头。"
          text="一个镜头只承载一个清楚的动作，故事就会更容易被看懂。"
          action="添加第一镜"
          onClick={add}
        />
      )}
      {hasSampleVideo && current.id === initialProject.id && (
        <section className="sample-video-section">
          <div>
            <Badge orange>本地示例成片</Badge>
            <h2>分镜之后，看看实际发生了什么。</h2>
            <p>
              计划分镜与生成结果可能有差异。对照检查动作衔接，记得亲自试听声音。
            </p>
            <Button icon={Play} onClick={() => setPlay(!play)}>
              {play ? "收起成片" : "播放示例成片"}
            </Button>
          </div>
          {play && <video controls autoPlay src={asset("sample.mp4")} />}
        </section>
      )}
      <div className="subtle-note">
        <Lightbulb size={17} />
        <span>还没有合适的镜头描述？</span>
        <button className="text-link" onClick={() => navigate("prompts")}>
          去提示词工坊完善 <ArrowUpRight size={14} />
        </button>
      </div>
    </>
  );
}
function Analysis() {
  const {
    generate, demo, setToast, exportText, copy, workspace,
    updateWorkspace, setState, navigate,
  } = useStudio();
  const [frames, setFrames] = useState([]),
    [mediaName, setMediaName] = useState(""),
    [duration, setDuration] = useState(0),
    [focus, setFocus] = useState("镜头语言与制作流程"),
    [question, setQuestion] = useState(""),
    [progress, setProgress] = useState(0),
    [reading, setReading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(workspace.referenceReport || ""),
    [isExample, setIsExample] = useState(false),
    [creating, setCreating] = useState(false),
    [creationError, setCreationError] = useState("");
  const input = useRef();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [videoUrl, setVideoUrl] = useState("");
  useEffect(
    () => () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    },
    [videoUrl],
  );
  async function importMedia(files) {
    const f = files?.[0];
    if (!f || reading || busy || creating) return;
    setError("");
    setResult("");
    setIsExample(false);
    setCreationError("");
    setFrames([]);
    setVideoUrl("");
    setDuration(0);
    setReading(true);
    setProgress(0);
    setMediaName(f.name);
    try {
      if (f.size > 200e6) throw new Error("单个视频请控制在 200 MB 以内。");
      if (f.type.startsWith("video/")) {
        setVideoUrl(URL.createObjectURL(f));
        const r = await extractFrames(f, setProgress);
        setFrames(r.frames);
        setDuration(r.duration);
      } else if (["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
        if (f.size > 4e6) throw new Error("图片请控制在 4 MB 以内。");
        const url = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("无法读取这张图片，请重新选择。"));
          reader.readAsDataURL(f);
        });
        setFrames([{ url, time: "静帧" }]);
        setDuration(0);
        setVideoUrl("");
      } else throw new Error("请选择视频或图片。");
    } catch (e) {
      setError(e.message);
      setMediaName("");
      setVideoUrl("");
    } finally {
      setReading(false);
    }
  }
  async function analyze() {
    if (!frames.length) {
      setError("先导入一段视频或一张画面参考。");
      return;
    }
    if (demo) {
      setError(
        "自定义素材分析需要连接支持图片输入的模型，并切换 API 模式。也可以查看下方的示例拆解。",
      );
      return;
    }
    setBusy(true);
    setError("");
    setCreationError("");
    try {
      const r = await generate(
        {
          prompt: `分析以下用户提供的漫剧采样帧。时长${duration.toFixed(2)}秒，采样时间：${frames.map((f) => f.time).join(",")}。重点：${focus}。用户问题：${question || "如何学习其制作方法？"}。请按“可见事实 / 可能的制作步骤（推测） / 可复用的提示词结构 / 一致性检查 / 不确定性与下一步”输出。注意：这些是稀疏采样，不包含音频，不能断言完整情节、精确切点、对白、具体模型、原始提示词或成本。`,
          images: frames.map((f) => f.url),
        },
        "",
      );
      setResult(r.text);
      setIsExample(false);
      updateWorkspace({ referenceReport: r.text });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function showExample() {
    setResult(demoAnalysis);
    setIsExample(true);
    setCreationError("");
  }
  async function createExercise() {
    if (creating || isExample || !result || demo) return;
    setCreating(true);
    setCreationError("");
    try {
      const response = await generate(
        { prompt: buildExercisePrompt(result), json: true },
        "",
      );
      const exercise = parseExercise(response.text, result);
      const openProject = mounted.current;
      const id = exercise.project.id;
      setState((s) => ({
        ...s,
        activeId: openProject ? id : s.activeId,
        projects: [...s.projects, exercise.project],
        workspaces: { ...s.workspaces, [id]: exercise.workspace },
      }));
      if (openProject) navigate("characters");
      setToast("练习项目已创建，包含角色卡、分镜和首版提示词");
    } catch (err) {
      if (mounted.current) setCreationError(err.message);
      else setToast(err.message);
    } finally {
      setCreating(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="REFERENCE BREAKDOWN"
        title="看懂一部作品，找到自己的方法。"
        description="从镜头、节奏与连续性，拆出你可以复用的创作思路。"
      >
        <Button
          icon={FileText}
          disabled={reading || busy || creating}
          onClick={() => {
            showExample();
            setToast("已载入本地示例复盘");
          }}
        >
          查看示例拆解
        </Button>
      </PageHeading>
      <div className="analysis-layout">
        <section className="analysis-input">
          <div className="panel-title">
            <h2>
              <MonitorPlay size={20} /> 导入参考素材
            </h2>
            <Badge>本地预处理</Badge>
          </div>
          <div
            className={`upload-zone ${reading ? "is-reading" : ""}`}
            role="button"
            tabIndex={0}
            aria-disabled={reading || busy || creating}
            onClick={() => !reading && !busy && !creating && input.current.click()}
            onKeyDown={(e) => e.key === "Enter" && !reading && !busy && !creating && input.current.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!reading) importMedia(e.dataTransfer.files);
            }}
          >
            <input
              ref={input}
              hidden
              type="file"
              accept="video/*,image/png,image/jpeg,image/webp"
              onChange={(e) => {
                importMedia(e.target.files);
                e.target.value = "";
              }}
            />
            {reading ? (
              <>
                <div className="sample-progress">
                  {progress} <span>/ 6</span>
                </div>
                <h3>正在本地提取画面…</h3>
                <p>原视频保留在你的设备上</p>
              </>
            ) : (
              <>
                <span className="upload-icon">
                  <UploadSimple size={30} weight="thin" />
                </span>
                <h3>{mediaName || "把一段好故事，拖到这里。"}</h3>
                <p>
                  {mediaName ? "点击更换参考素材" : "支持视频或单张画面参考"}
                </p>
                <small>推荐 H.264 MP4 · 视频 ≤ 200 MB · 图片 ≤ 4 MB</small>
              </>
            )}
          </div>
          {frames.length > 0 && (
            <>
              <div className="sample-heading">
                <h3>将发送的采样帧</h3>
                <span>
                  {frames.length} 张{" "}
                  {duration > 0 ? `/ ${duration.toFixed(1)}s` : ""}
                </span>
              </div>
              <div className="sample-frames">
                {frames.map((f, i) => (
                  <figure key={i}>
                    <img src={f.url} alt={`采样 ${f.time}s`} />
                    <figcaption>
                      {f.time}
                      {f.time === "静帧" ? "" : "s"}
                    </figcaption>
                  </figure>
                ))}
              </div>
              {videoUrl && (
                <details className="video-details">
                  <summary>在本地播放原片，试听声音</summary>
                  <video src={videoUrl} controls />
                </details>
              )}
            </>
          )}
          <div className="analysis-options">
            <Field label="这次重点看什么？">
              <select value={focus} onChange={(e) => setFocus(e.target.value)}>
                {[
                  "镜头语言与制作流程",
                  "角色一致性与参考图",
                  "叙事节奏与悬念设计",
                  "画面风格与提示词结构",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="你想弄明白的问题（可选）">
              <textarea
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="例如：为什么信封的特写能推动叙事？"
              />
            </Field>
            <div className="info-banner">
              <ImageSquare size={19} />
              <p>
                点击分析后，仅将上方采样帧和文字发送至已连接的模型。视觉分析不包含音轨，无法确认原作者使用的模型与提示词。
              </p>
            </div>
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <Button
              kind="primary"
              className="full-width"
              icon={MagicWand}
              disabled={busy || creating || reading || !frames.length}
              onClick={analyze}
            >
              {busy ? "正在拆解参考片…" : "开始 AI 拆解"}
            </Button>
          </div>
        </section>
        <section className="analysis-output">
          <div className="panel-title">
            <h2>制作流程拆解</h2>
            <div className="button-row">
              <IconButton
                icon={Copy}
                label="复制拆解结果"
                disabled={!result}
                onClick={() => copy(result)}
              />
              <IconButton
                icon={Download}
                label="导出拆解结果"
                disabled={!result}
                onClick={() => exportText("参考片拆解.txt", result)}
              />
            </div>
          </div>
          {busy ? (
            <div className="skeleton-output">
              <i />
              <i />
              <i />
              <i />
            </div>
          ) : result ? (
            <>
              <div className="analysis-result">
                {result.split("\n\n").map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
              {!isExample && (
                <div className="exercise-actions">
                  <p>{demo
                    ? "切换至 API 模式可根据这份拆解创建项目。"
                    : "将这份文字拆解发送给模型，生成一个含角色卡、分镜和提示词的独立项目。"}
                  </p>
                  <Button
                    kind="primary"
                    icon={Plus}
                    disabled={demo || creating || reading}
                    onClick={createExercise}
                  >
                    {creating ? "正在设计练习项目…" : "生成原创练习项目"}
                  </Button>
                  {creationError && (
                    <div role="alert" className="inline-error">{creationError}</div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="analysis-empty">
              <div className="breakdown-illustration">
                <span>
                  <FilmStrip size={37} weight="thin" />
                </span>
                <ArrowRight size={20} />
                <span>
                  <Stack size={37} weight="thin" />
                </span>
              </div>
              <h2>
                不止看见画面，
                <br />
                也看见画面背后的选择。
              </h2>
              <p>导入素材后，从这些角度开始研究。</p>
              {[
                ["01", "镜头与构图", "景别、人物位置与视觉重心"],
                ["02", "叙事与连续性", "动作怎样衔接，悬念怎样出现"],
                ["03", "制作步骤推测", "从角色参考到分镜与剪辑"],
              ].map(([n, t, d]) => (
                <div className="breakdown-step" key={n}>
                  <span>{n}</span>
                  <div>
                    <strong>{t}</strong>
                    <p>{d}</p>
                  </div>
                </div>
              ))}
              <button
                className="text-link"
                onClick={showExample}
              >
                先看示例复盘 <ArrowUpRight size={15} />
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function Learn() {
  const { state, setState, navigate } = useStudio();
  const [selected, setSelected] = useState(0);
  const lesson = lessons[selected];
  const completed = state.completed || [];
  function mark() {
    setState((s) => ({
      ...s,
      completed: s.completed?.includes(selected)
        ? s.completed
        : [...(s.completed || []), selected],
    }));
  }
  return (
    <>
      <PageHeading
        eyebrow="THE FIRST STORY GUIDE"
        title="每位创作者，都有第一幕。"
        description="不必一次学会全部。跟着六个小节，把第一个 15 秒故事做出来。"
      >
        <Badge orange>{completed.length} / 6 已完成</Badge>
      </PageHeading>
      <div className="academy-layout">
        <aside className="course-list">
          <div className="course-label">
            <BookOpen size={20} />
            <strong>从零到第一部漫剧</strong>
            <small>6 小节 · 约 32 分钟</small>
          </div>
          {lessons.map((l, i) => (
            <button
              className={selected === i ? "active" : ""}
              key={l.title}
              onClick={() => setSelected(i)}
            >
              <span
                className={`lesson-index ${completed.includes(i) ? "done" : ""}`}
              >
                {completed.includes(i) ? (
                  <Check size={15} />
                ) : (
                  String(i + 1).padStart(2, "0")
                )}
              </span>
              <div>
                <strong>{l.title}</strong>
                <small>
                  {l.category} · {l.time}
                </small>
              </div>
              <CaretRight size={14} />
            </button>
          ))}
          <div className="course-progress">
            <span>离第一部作品，又近了一步</span>
            <div className="progress-track">
              <span style={{ width: `${(completed.length / 6) * 100}%` }} />
            </div>
          </div>
        </aside>
        <article className="lesson-content">
          <div className="lesson-top-art">
            <FilmStrip size={70} weight="thin" />
            <span>
              YOUR FIRST
              <br />
              <b>15 SECONDS.</b>
            </span>
            <span className="lesson-art-number">0{selected + 1}</span>
          </div>
          <div className="lesson-body">
            <div className="lesson-category">
              <Badge orange>{lesson.category}</Badge>
              <span>
                <Clock size={14} />
                {lesson.time}
              </span>
            </div>
            <h2>{lesson.title}</h2>
            <p className="lesson-intro">{lesson.intro}</p>
            <div className="lesson-copy">
              {lesson.body.split("\n\n").map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <div className="lesson-task">
              <span>
                <Lightbulb size={23} />
              </span>
              <div>
                <strong>动手做一次</strong>
                <p>{lesson.task}</p>
              </div>
              <Button onClick={() => navigate(lesson.route)}>
                去试一试 <ArrowUpRight size={15} />
              </Button>
            </div>
            <div className="lesson-footer">
              <Button
                icon={CheckCircle}
                kind={completed.includes(selected) ? "" : "primary"}
                onClick={mark}
              >
                {completed.includes(selected) ? "已完成本节" : "标记本节完成"}
              </Button>
              {selected < 5 && (
                <Button onClick={() => setSelected(selected + 1)}>
                  下一小节 <ArrowRight size={16} />
                </Button>
              )}
            </div>
          </div>
        </article>
      </div>
    </>
  );
}
function Settings({ authenticated = false }) {
  const { settings, setSettings, setDemo, setToast } = useStudio();
  const official = settings.openAIPreset;
  const defaultOpenAI = settings.provider === "openai" && official;
  const [form, setForm] = useState({
      provider: settings.provider || "custom",
      baseURL: settings.baseURL || (defaultOpenAI ? official.baseURL : ""),
      model: settings.model || (defaultOpenAI ? official.model : ""),
      apiKey: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [visible, setVisible] = useState(false);
  const native = !!window.studio;
  const isCloud = form.provider === "tencent";
  const hasChanges = form.apiKey !== "" || form.baseURL !== settings.baseURL ||
    form.model !== settings.model || form.provider !== settings.provider;
  function change(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setError("");
    setSuccess("");
  }
  async function save(e) {
    e.preventDefault();
    if (!native) {
      setError(
        "浏览器为界面预览。请打开本地 Mac App 连接模型，密钥不会保存在浏览器里。",
      );
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const s = await nativeCall("saveSettings", form);
      setSettings(s);
      setForm({ provider: s.provider, baseURL: s.baseURL, model: s.model, apiKey: "" });
      setVisible(false);
      setSuccess("连接配置已加密保存。点击「测试连接」可验证并启用 API 模式。");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const r = await nativeCall("testConnection");
      setSuccess("模型连接成功：" + r.message);
      setDemo(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    try {
      setSettings(await nativeCall("disconnect"));
      setDemo(true);
      setSuccess("已移除本地连接和已保存的密钥。");
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="MODEL CONNECTIONS"
        title="你的模型，你的创作方式。"
        description="连接 OpenAI 或自定义兼容服务，在提示词、角色卡和参考片拆解中使用同一个模型。"
      />
      <div className="settings-layout">
        <form className="settings-form" onSubmit={save}>
          <div className="panel-title">
            <h2>
              <Plugs size={21} /> AI 模型连接
            </h2>
            <Badge orange>{settings.hasKey ? "已保存配置" : "尚未连接"}</Badge>
          </div>
          <div className="settings-fields">
            <div className={`provider-options ${official ? "with-openai" : ""}`}>
              {[
                ...(official ? [["openai", "OpenAI GPT", "文字与参考帧分析"]] : []),
                ...(settings.cloudModel ? [["tencent", "云端模型转发", "需服务器启用模型"]] : []),
                ["custom", "自定义服务", "OpenAI 兼容接口"],
                ["deepseek", "DeepSeek", "文本创作与改写"],
                ["siliconflow", "硅基流动", "按模型选择能力"],
              ].map(([id, t, d]) => (
                <button
                  type="button"
                  key={id}
                  className={form.provider === id ? "active" : ""}
                  onClick={() => {
                    setForm((f) => ({
                      ...f,
                      provider: id,
                      baseURL:
                        id === "openai" ? official.baseURL : id === "deepseek"
                          ? "https://api.deepseek.com"
                          : id === "siliconflow"
                            ? "https://api.siliconflow.cn/v1"
                            : "",
                      model: id === "tencent" ? settings.cloudModel : id === "openai" ? official.model : "",
                      apiKey: "",
                    }));
                    setSuccess("");
                    setError("");
                  }}
                >
                  <span className="provider-letter">{t.slice(0, 1)}</span>
                  <strong>{t}</strong>
                  <small>{d}</small>
                  {form.provider === id && <CheckCircle size={16} />}
                </button>
              ))}
            </div>
            <Field
              label={isCloud ? "腾讯云服务根地址" : "API 地址（Base URL）"}
              helper={isCloud ? "填写你部署的漫序后台 HTTPS 地址，可包含路径前缀。" : "填写服务商提供的 HTTPS 地址，可包含 /v1；本地服务可使用 http://localhost。"}
            >
              <input
                type="url"
                required
                readOnly={form.provider === "openai"}
                value={form.baseURL}
                onChange={(e) => change("baseURL", e.target.value)}
                placeholder="https://your-provider.example/v1"
                autoComplete="off"
              />
            </Field>
            <Field
              label="模型 ID"
              helper="精确填写服务商的模型 ID。参考片分析需要模型支持图片输入。"
            >
              <input
                required
                value={form.model}
                readOnly={isCloud}
                onChange={(e) => change("model", e.target.value)}
                placeholder="填写服务商控制台中的模型 ID"
                autoComplete="off"
              />
            </Field>
            <Field
              label={isCloud ? "云服务访问令牌" : "API Key"}
              helper={
                isCloud ? "填写服务器配置的漫序应用令牌。OpenAI 密钥由服务器保存。" : settings.hasKey
                  ? "已保存密钥。留空会保留当前密钥；更换服务商时请填写新密钥。"
                  : "模型地址、模型 ID 和密钥在本机一并加密，由 macOS 钥匙串保护。"
              }
            >
              <div className="key-input">
                <input
                  type={visible ? "text" : "password"}
                  required={!settings.hasKey}
                  value={form.apiKey}
                  onChange={(e) => change("apiKey", e.target.value)}
                  placeholder={
                    settings.hasKey && form.provider === settings.provider ? "已保存 · 输入可替换" : isCloud ? "输入云服务访问令牌" : "输入 API Key"
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="button" onClick={() => setVisible(!visible)}>
                  {visible ? "隐藏" : "显示"}
                </button>
              </div>
            </Field>
            {!native && (
              <div className="info-banner">
                <MonitorPlay size={19} />
                <p>你正在查看浏览器原型。真实 API 连接请在 Mac App 中配置。</p>
              </div>
            )}
            {error && (
              <div className="inline-error" role="alert">
                <WarningCircle size={16} />
                {error}
              </div>
            )}
            {success && (
              <div className="inline-success" role="status">
                <CheckCircle size={17} />
                {success}
              </div>
            )}
            <div className="settings-actions">
              <Button
                kind="primary"
                icon={FloppyDisk}
                type="submit"
                disabled={busy}
              >
                {busy ? "正在处理…" : "保存连接配置"}
              </Button>
              <Button
                icon={Plugs}
                type="button"
                disabled={busy || !settings.hasKey || !native || hasChanges}
                onClick={test}
              >
                测试连接
              </Button>
              {settings.hasKey && (
                <button
                  type="button"
                  className="text-link danger"
                  onClick={disconnect}
                >
                  移除连接
                </button>
              )}
            </div>
            <p className="settings-footnote">
              测试连接会发起一次模型请求，按服务商标准计费。OpenAI 测试使用应用自带的色块图验证读图能力。
            </p>
          </div>
        </form>
        <aside className="settings-aside">
          <div className="privacy-mark">
            <LockKey size={32} weight="thin" />
          </div>
          <h2>
            创作在本地，
            <br />
            连接由你决定。
          </h2>
          <div>
            <CheckCircle size={17} />
            <p>
              <strong>密钥加密保存</strong>
              <span>不写入项目备份，也不上传 GitHub。</span>
            </p>
          </div>
          <div>
            <CheckCircle size={17} />
            <p>
              <strong>按操作发送内容</strong>
              <span>点击生成才发送当前提示词；分析前先检查采样帧。</span>
            </p>
          </div>
          <div>
            <CheckCircle size={17} />
            <p>
              <strong>离线也能整理创作</strong>
              <span>角色卡、分镜、教程和项目备份都可以在本地使用。</span>
            </p>
          </div>
          <div className="compatibility-note">
            <strong>第一版支持范围</strong>
            <p>
              文本模型用于提示词与角色设定；图片输入模型用于参考帧分析。图片和视频生成、语音识别可在后续版本扩展。
            </p>
          </div>
        </aside>
      </div>
      {settings.cloudModel && <BackupSettings />}
    </>
  );
}
function BackupSettings() {
  const { settings, setSettings } = useStudio();
  const [baseURL, setURL] = useState(settings.backupURL || "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const dirty = token !== "" || baseURL !== (settings.backupURL || "");
  async function apply(action) {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      if (action === "test") {
        const r = await nativeCall("testBackupSettings");
        setStatus(r.message);
      } else {
        const next = action === "save"
          ? await nativeCall("saveBackupSettings", {baseURL, token})
          : await nativeCall("removeBackupSettings");
        setSettings(next);
        setURL(next.backupURL || "");
        setToken("");
        setStatus(action === "save" ? "备份连接已加密保存" : "已移除本机备份连接");
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <form className="settings-form" onSubmit={(e) => {e.preventDefault(); apply("save");}}>
      <div className="panel-title"><h2>独立腾讯云备份</h2><Badge>{settings.cloudBackups ? "已绑定" : "未绑定"}</Badge></div>
      <div className="settings-fields">
        <p>备份连接与上方模型连接分别保存。检测备份只读取云端备份列表。</p>
        <Field label="备份服务根地址">
          <input type="url" required autoComplete="off" value={baseURL} onChange={(e)=>setURL(e.target.value)} />
        </Field>
        <Field label="备份服务令牌">
          <input type="password" required={!settings.cloudBackups} autoComplete="off" value={token}
            placeholder={settings.cloudBackups ? "已保存 · 输入可替换" : "输入云服务访问令牌"}
            onChange={(e)=>setToken(e.target.value)} />
        </Field>
        {error && <p role="alert" className="inline-error">{error}</p>}
        {status && <p role="status" className="inline-success">{status}</p>}
        <div className="settings-actions">
          <Button type="submit" disabled={busy}>保存备份配置</Button>
          <Button type="button" disabled={busy || !settings.cloudBackups || dirty} onClick={()=>apply("test")}>检测备份连接</Button>
          {settings.cloudBackups && <Button type="button" disabled={busy} onClick={()=>apply("remove")}>移除备份连接</Button>}
        </div>
      </div>
    </form>
  );
}
function CommandPalette({ close }) {
  const { navigate } = useStudio();
  const [query, setQuery] = useState("");
  const items = [
    ...nav.map(([id, label, Icon]) => ({ id, label, Icon })),
    { id: "settings", label: "连接 AI 模型", Icon: Plugs },
  ].filter((v) => v.label.includes(query));
  return (
    <div className="modal-overlay command-overlay" onClick={close}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-search">
          <MagnifyingGlass size={21} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="你想开始哪一步？"
          />
          <kbd onClick={close}>ESC</kbd>
        </div>
        <div className="command-items">
          <span>快速前往</span>
          {items.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => navigate(id)}>
              <Icon size={19} />
              {label}
              <ArrowUpRight size={16} />
            </button>
          ))}
          {!items.length && <p>暂时没找到，试试“角色”或“教程”。</p>}
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
