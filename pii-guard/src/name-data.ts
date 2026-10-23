/**
 * 人名启发式用到的静态数据（byted_refined）。
 *
 * 与 tools/scan-names.mjs 共用同一份姓氏/称谓表，避免「扫描器认得出、运行时认不出」
 * 这种两套标准的问题。
 */

/** 常见单姓（百家姓高频段，覆盖绝大多数真实姓名） */
export const SURNAMES = new Set(
  "赵钱孙李周吴郑王冯陈蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊惠甄曲".split(
    "",
  ),
);

/** 复姓：命中时名字总长可以到 4 */
export const COMPOUND_SURNAMES = new Set([
  "欧阳", "司马", "上官", "诸葛", "东方", "皇甫", "尉迟", "公孙", "慕容",
  "司徒", "令狐", "长孙", "宇文", "夏侯", "端木", "独孤", "南宫", "西门",
  "轩辕", "赫连", "澹台", "公冶", "宗政", "濮阳", "淳于", "单于", "太叔",
  "申屠", "公羊", "闻人", "夏候", "万俟", "闻人",
]);

/** 称谓后缀：名字出现在这些词前面时，几乎一定是人名 */
export const NAME_TITLES = [
  "老师", "同学", "先生", "女士", "小姐", "经理", "总监", "顾问", "教授",
  "博士", "师兄", "师姐", "学长", "学姐", "主管", "领导", "导师", "主任",
  "总裁", "总经理", "律师", "医生", "医师", "秘书", "助理", "老板",
];

/** 引导词：明确在介绍姓名 */
export const NAME_INTROS = ["名叫", "叫做", "叫", "姓名是", "姓名", "联系人", "当事人"];

/**
 * 噪音词：以姓氏开头但绝不是人名的高频词。
 * 宁可漏掉一个人名（下次靠词表补），也不要把「高兴」换成占位符——
 * 后者会被模型当成实体，直接污染回答。
 */
export const NAME_NOISE = new Set(
  (
    "任何 时间 申请 公开 文书 方式 项目 简历 文件 后台 通过 平台 支付 公司 空缺 关键 任务 关系 通知 权限 应用 能手 连接 内容 能力 劳动 行业 市场 产品 服务 系统 数据 模型 用户 客户 工程 指导 支持 分析 建设 学习 工作 活动 咨询 交流 回访 对接 交付 评审 分享 讲解 复盘 规划 沟通 协作 反馈 建议 意见 说明 介绍 汇报 总结 记录 附录 参考 模板 版本 修改 更新 补充 确认 整理 归档 草稿 素材 要点 提纲 口径 细节 流程 机制 规则 标准 指标 阶段 周期 节点 排期 预算 成本 收益 增长 转化 留存 曝光 渠道 策略 打法 案例 经验 教训 空档 窗口 视野 认知 思维 逻辑 结构 框架 体系 方法 工具 生态 趋势 红利 增量 存量 品类 品牌 定位 人群 场景 需求 痛点 卖点 价值 优势 劣势 机会 风险 我们 你们 他们 这个 那个 什么 怎么 为了 因为 所以 以及 并且 如果 但是 而且 因此 高兴 马上 方向 周末 金色 石头 白色 黄金 银子 江边 林间 程度 严重 何时 成语 王者 黄昏 曾经 于是 向来 何况 毛病 叶子 花园 段落 雷同 温和 史前 报告 笔记 方案 计划 目标 进度 资料 信息 材料 文档 章节 段落 标题 作者 读者 大家 对方 自己 有人 某人 这位 那位"
  )
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * 「XX老师」这个槽位专用噪音词。
 *
 * 用户口径（2026-10-22）：称呼老师一定带「老师」二字，所以槽位本身是可靠信号；
 * 但「语文老师」「班主任老师」「各位老师」里的 XX 不是人名，必须排除。
 */
export const TEACHER_NOISE = new Set(
  (
    "语文 数学 英语 物理 化学 生物 历史 地理 政治 体育 音乐 美术 信息 科学 心理 计算机 编程 写作 阅读 口语 听力 语法 作文 选修 必修 实验 理论 实践 专业 公共 基础 核心 通识 年级 班级 系里 院里 学校 学院 大学 高中 初中 小学 幼儿园 " +
    "班主任 年级组长 教研 指导 任课 代课 实习 外教 家教 补课 辅导 主讲 授课 监考 阅卷 答辩 论文 毕业 招生 教务 行政 客座 兼职 特聘 荣誉 名誉 退休 新来 年轻 资深 高级 特级 优秀 骨干 " +
    "全体 各位 所有 每位 任何 其他 咱们 我们 你们 他们 这个 那个 哪个 一个 一位 两位 三位 哪位 别的 自己的 亲爱的 尊敬的 代班 值班 当日 当天 上面 下面 前面 后面"
  )
    .split(/\s+/)
    .filter(Boolean),
);

export const COMMON_WORDS_2 = new Set(
  (
    '之前 之后 然后 时候 现在 一个 这个 那个 什么 怎么 我们 他们 你们 自己 知道 觉得 没有 已经 还有 以及 或者 而且 不过 其实 当然 一定 大家 一起 一样 这样 那样 怎样 为什么 因为 所以 如果 虽然 但是 于是 就是 还是 只是 而是 也是 都是 却是 正是 总是 像是 算是 作为 成为 认为 以为 所谓 所有 有些 有点 比较 非常 特别 马上 立刻 刚刚 经常 偶尔 一般 通常 主要 重要 直接 具体 一下 一些 一点 很多 更多 最好 最后 第一 第二 首先 其次 另外 此外 同时 仍然 依然 确实 显然 自然 必然 居然 竟然 反而 总之 毕竟 到底 究竟 难道 何必 何况 即便 即使 除非 只要 只有 无论 不管 尽管 可以 可能 应该 需要 不会 不能 不要 上次 下次 今天 明天 昨天 今年 去年 明年 上午 下午 晚上 中午'
  )
    .split(/\s+/)
    .filter(Boolean),
);

/** 双字候选的末字若是这些语法字，几乎不可能是名字（而是/就是/还是/但是/已经/…） */
export const GRAMMAR_TAIL = new Set(
  '的了是在和与也就都还很我你他她它们这那哪什么怎为因所但而如果然可以能会要有没不别太最更还再又已经正想看去来着过做吗呢吧啊呀个些及者且己道得实样'.split(""),
);

/** 拉丁写法里不是人名的常见词（避免「English同学」被当成名字） */
export const LATIN_NOISE = new Set(
  (
    'english chinese math maths physics chemistry biology history geography politics pe art music science computer coding writing reading speaking listening grammar teacher all every each any our your their this that these those new old young senior junior head class school college university prof professor mr ms mrs dr the and or but if else for with without about into onto over under between among during through across along around behind below beside beyond near off on out up down in at by from to of as than per via etc before after now since when while because although though however therefore also just only even still already always never often sometimes usually today yesterday tomorrow first second next last there here where why how what which who whom whose some both few many much more most other another such same own very too yes no am is are was were be been being have has had do does did will would can could should may might must shall'
  ).split(/\s+/),
);

/** 这些字出现在候选前面时，视为「另一个词的边界」，允许非姓氏开头的两字候选 */
export const FUNCTION_CHARS = new Set("和跟与找问让请叫给对向同是的了把被帮带约聊说发接".split(""));
