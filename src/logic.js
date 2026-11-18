export function demoPrompt({
  idea,
  role,
  style,
  ratio,
  duration,
  mode,
  instruction = "",
  previous = "",
}) {
  if (previous.trim()) {
    const draft = previous.split("\n\n本轮模板修改要求\n")[0];
    return `${draft}\n\n本轮模板修改要求\n${instruction || "复核当前版本中的动作顺序和相邻镜头的衔接。"}`;
  }
  const beats = idea
    .split(/[。！\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return `【${mode} · 本地结构化演示】\n\n创作目标\n${idea}\n\n视觉与规格\n${style}，${ratio} 画幅，目标时长 ${duration} 秒。镜头服从故事，保持自然运动。\n\n角色一致性\n${role ? `${role.name}：${role.appearance}\n固定特征：${role.locked}` : "先创建角色卡，再锁定五官、发型、服装与道具。"}\n\n动作组织\n${beats.map((x, i) => `${String(i + 1).padStart(2, "0")} · ${x}。明确这一动作的起点、终点与前后衔接。`).join("\n")}\n\n镜头约束\n先用中景建立空间，再用近景或特写突出关键动作。保持轴线、视线和物体位置一致；避免在同一时刻要求相反动作。\n\n修改方向\n${instruction || "保留原始情节，将抽象情绪改成可见的小幅动作。"}\n\n避免\n${role?.negative || "角色外貌漂移、服装突变、道具瞬移、空间跳跃。"}\n\n核验\n生成后逐镜检查人物、动作和声音。此结果由本地模板整理。`;
}
export function validateProject(data) {
  if (
    !data ||
    data.schema !== 1 ||
    !Array.isArray(data.projects) ||
    !Array.isArray(data.roles) ||
    !Array.isArray(data.shots)
  )
    throw new Error(
      "文件格式不正确，请选择漫序 Studio 导出的加密文件或旧版 JSON 备份。",
    );
  if (
    data.projects.length > 100 ||
    data.roles.length > 100 ||
    data.shots.length > 500
  )
    throw new Error("导入内容过大。");
  const allowed = (v, keys) =>
    Object.fromEntries(
      keys
        .filter((k) => typeof v[k] === "string")
        .map((k) => [k, v[k].slice(0, k === "image" ? 6000000 : 40000)]),
    );
  const projects = data.projects.map((p) => {
    if (!p || !p.id || !p.name) throw new Error("项目缺少名称或编号。");
    return allowed(p, [
      "id",
      "name",
      "genre",
      "ratio",
      "duration",
      "summary",
      "updated",
    ]);
  });
  const roles = data.roles.map((p) => {
    if (!p || !p.id || !p.name) throw new Error("角色缺少名称或编号。");
    const role = allowed(p, [
      "id",
      "name",
      "tag",
      "age",
      "personality",
      "description",
      "appearance",
      "locked",
      "negative",
      "image",
    ]);
    if (
      role.image &&
      !/^(data:image\/(png|jpeg|webp);base64,|[a-z0-9-]+\.(png|svg)$)/i.test(
        role.image,
      )
    )
      delete role.image;
    return role;
  });
  const shots = data.shots.map((p) => {
    if (!p || typeof p.id !== "string") throw new Error("分镜资料缺少编号。");
    const shot = allowed(p, [
      "id",
      "number",
      "title",
      "time",
      "scale",
      "movement",
      "action",
      "audio",
      "image",
    ]);
    if (
      shot.image &&
      !/^(data:image\/(png|jpeg|webp);base64,|[a-z0-9-]+\.(png|svg)$)/i.test(
        shot.image,
      )
    )
      delete shot.image;
    return {
      ...shot,
      duration: Math.max(1, Math.min(120, Number(p.duration) || 3)),
    };
  });
  const history = Array.isArray(data.history)
    ? data.history
        .slice(0, 30)
        .filter(
          (entry) =>
            entry &&
            typeof entry.text === "string" &&
            typeof entry.id === "string",
        )
        .map((entry) => ({
          ...allowed(entry, ["id", "text", "date", "mode"]),
          demo: !!entry.demo,
        }))
    : [];
  return {
    ...data,
    projects,
    roles,
    shots,
    history,
    referenceReport:
      typeof data.referenceReport === "string"
        ? data.referenceReport.slice(0, 40000)
        : "",
    prompt: typeof data.prompt === "string" ? data.prompt.slice(0, 40000) : "",
  };
}
export async function extractFrames(file, onProgress = () => {}) {
  const url = URL.createObjectURL(file),
    video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.preload = "auto";
  const once = (name) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        cleanup();
        reject(new Error("读取视频超时，请使用 H.264 MP4 文件。"));
      }, 15000);
      const cleanup = () => {
        clearTimeout(t);
        video.removeEventListener(name, ok);
        video.removeEventListener("error", fail);
      };
      const ok = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new Error("无法解码该视频，请换用 MP4 文件。"));
      };
      video.addEventListener(name, ok, { once: true });
      video.addEventListener("error", fail, { once: true });
    });
  try {
    await once("loadeddata");
    if (!Number.isFinite(video.duration) || video.duration <= 0)
      throw new Error("无法读取视频时长。");
    const canvas = document.createElement("canvas"),
      scale = Math.min(640 / video.videoWidth, 640 / video.videoHeight, 1);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d"),
      frames = [];
    for (let i = 0; i < 6; i++) {
      const time = Math.max(0.01, (video.duration * (i + 0.5)) / 6);
      const seeked = once("seeked");
      video.currentTime = time;
      await seeked;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({
        time: time.toFixed(2),
        url: canvas.toDataURL("image/jpeg", 0.72),
      });
      onProgress(i + 1);
    }
    return { frames, duration: video.duration };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
