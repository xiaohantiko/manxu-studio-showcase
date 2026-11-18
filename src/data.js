export const hasSampleVideo = false;
const illustrations = new Set([
  "portrait",
  "costume",
  "expression",
  "hallway",
  "shot-1",
  "shot-2",
  "shot-3",
  "shot-4",
]);
export const asset = (name) => {
  const id = String(name || "").replace(/\.(png|svg)$/i, "");
  // Old sample images are not served. Legacy references use synthetic illustrations.
  return `${import.meta.env.BASE_URL}assets/${illustrations.has(id) ? id : "portrait"}.svg`;
};
export const initialProject = {
  id: "sample",
  name: "灯塔来信",
  genre: "治愈奇幻",
  ratio: "9:16",
  duration: "15",
  summary: "海边小镇的邮差，收到了一封来自明天的信。",
  updated: "创作示例",
};
export const initialRole = {
  id: "zhiyou",
  name: "许知遥",
  tag: "主角",
  age: "25",
  personality: "细心、好奇、沉静",
  description:
    "海边小镇的邮差。她习惯照顾每一封信，直到发现了一封日期来自明天的来信。",
  appearance: "齐肩深棕发，米色风衣，墨绿帆布邮包，左手拿信。",
  locked: "齐肩深棕发；米色风衣；墨绿邮包；左手持信。",
  negative: "发型变化、服装突变、邮包变色、信件瞬移。",
  image: "portrait.svg",
};
export const initialShots = [
  {
    id: "s1",
    number: "01",
    title: "抵达海边",
    time: "0–3s",
    duration: 3,
    scale: "全景",
    movement: "缓慢推进",
    action: "许知遥沿着海堤走向灯塔。",
    audio: "轻微海风与脚步。",
    image: "shot-1.svg",
  },
  {
    id: "s2",
    number: "02",
    title: "收到来信",
    time: "3–7s",
    duration: 4,
    scale: "中景",
    movement: "固定机位",
    action: "她从邮包中拿出一封信，看向信封日期。",
    audio: "纸张轻响。",
    image: "shot-2.svg",
  },
  {
    id: "s3",
    number: "03",
    title: "未来日期",
    time: "7–11s",
    duration: 4,
    scale: "特写",
    movement: "轻微推进",
    action: "信封日期写着明天；左手保持拿信。",
    audio: "风声渐轻。",
    image: "shot-3.svg",
  },
  {
    id: "s4",
    number: "04",
    title: "望向灯塔",
    time: "11–15s",
    duration: 4,
    scale: "近景",
    movement: "固定机位",
    action: "她抬头望向灯塔，神情由疑惑转为好奇。",
    audio: "灯塔方向传来一声清脆铃响。",
    image: "shot-4.svg",
  },
];
export const initialPrompt =
  "海边小镇的邮差许知遥，收到了一封来自明天的信。她看向信封上的日期，又抬头望向灯塔。想要温柔的手绘动画，15 秒竖屏。";
export const lessons = [
  {
    title: "先拍一个 15 秒的故事",
    category: "创作起步",
    time: "4 分钟",
    intro: "从一个角色、一个空间、一个变化开始。",
    body: "先确定主角想做什么，以及一个打断日常的异常。\n\n把故事拆成建立空间、发现线索、人物反应、留下悬念四个动作。每个动作分配 3–4 秒。\n\n不要急着增加角色与场景。先让观众理解发生了什么。",
    task: "新建项目，用一句话写出故事变化。",
    route: "projects",
  },
  {
    title: "做一张不会变脸的角色卡",
    category: "角色一致性",
    time: "6 分钟",
    intro: "用参考图和可见特征固定人物身份。",
    body: "记录身份、外貌、服装、性格与固定道具。\n\n齐肩深棕发、米色风衣，比精致漂亮更便于检查。\n\n生成后分别核对五官、发型、衣服和道具。",
    task: "创建一张角色卡并锁定关键特征。",
    route: "characters",
  },
  {
    title: "把想法写成可执行的提示词",
    category: "提示词工坊",
    time: "7 分钟",
    intro: "主体、空间、动作、镜头、声音和约束。",
    body: "先写谁、在哪，再写动作的起点与终点。\n\n每个镜头的动作保持清楚，避免同时要求相反动作。\n\n只保留重要负向约束，生成后检查实际效果。",
    task: "把一句灵感整理为完整提示词。",
    route: "prompts",
  },
  {
    title: "先交代空间，再表达情绪",
    category: "分镜语言",
    time: "5 分钟",
    intro: "用景别和轴线帮助观众看懂关系。",
    body: "中景交代空间，近景呈现情绪，特写突出线索。\n\n注意角色位置、视线方向和道具所在的手。\n\n计划分镜与实际切镜要分别记录。",
    task: "检查动作是否在相邻镜头中衔接。",
    route: "storyboard",
  },
  {
    title: "拆解参考片",
    category: "参考片研究",
    time: "6 分钟",
    intro: "区分可见事实、制作推测和未知信息。",
    body: "记录景别、构图、人物位置与动作。\n\n可以提出可能的制作步骤，但无法从成片确认原始提示词、模型或成本。\n\n采样帧不含声音，仍需另外试听。",
    task: "导入一段参考视频，检查采样帧。",
    route: "analysis",
  },
  {
    title: "完成前的最后一次检查",
    category: "交付与验片",
    time: "4 分钟",
    intro: "对照计划检查画面，并亲自试听声音。",
    body: "分别检查人物、服装、空间、动作、道具与声音。\n\n发现变化后，先判断是否影响故事因果。\n\n保留项目备份，记录要修正的问题。",
    task: "导出一份项目备份。",
    route: "projects",
  },
];
export const demoAnalysis =
  "示例流程 · 灯塔来信\n\n可见事实\n角色沿海堤前行、查看信封、抬头看向灯塔。此内容是虚构示例，未执行真实 AI 分析。\n\n可能的制作流程（推测）\n人物与场景设定 → 四镜静帧 → 动画生成 → 声音与剪辑 → 一致性验片。\n\n可复用的方法\n用信封特写交代线索，再用人物近景承接反应。固定风衣、邮包与拿信的手。\n\n不确定项\n采样帧不能确认音频、精确切点、原始提示词、模型与成本。";
