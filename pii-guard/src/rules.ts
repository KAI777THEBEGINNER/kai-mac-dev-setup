/**
 * 正则规则集：结构化身份信息与凭据。
 * 设计原则：高精度优先 —— 宁可少挡一个"像卡号的订单号"，也不要把普通文本误伤成占位符。
 * 每条规则可带 validate 做二次校验（如 Luhn），把误报压下去。
 */

export interface RegexRule {
  /** 占位符类别，输出 <<LABEL:N>> */
  label: string;
  /** 必须带 g 标志 */
  pattern: RegExp;
  /** 二次校验：返回 false 则该匹配被丢弃 */
  validate?: (matched: string) => boolean;
  /** 中文说明，用于文档与自检 */
  description: string;
}

/** Luhn 校验（银行卡号标准校验位） */
export function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export const DEFAULT_RULES: RegexRule[] = [
  {
    label: "EMAIL",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    description: "邮箱地址",
  },
  {
    label: "PHONE",
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    description: "中国大陆手机号（11 位）",
  },
  {
    label: "ID_CARD",
    pattern:
      /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
    description: "中国大陆身份证号（18 位，含末位 X）",
  },
  {
    label: "PASSPORT",
    pattern: /(?<![A-Za-z0-9])[EG]\d{8}(?![A-Za-z0-9])/g,
    description: "中国护照号（E 新版 / G 旧版 + 8 位数字）",
  },
  {
    label: "BANK_CARD",
    pattern: /(?<!\d)\d{14,19}(?!\d)/g,
    // 首位限 3/4/5/6（银联/visa/master/amex/diners/jcb），再过 Luhn，双层压误报
    validate: (s) => "3456".includes(s[0]) && luhn(s),
    description: "银行卡号（14-19 位 + Luhn + 首位约束，含 Amex 15 / Diners 14）",
  },

  // ---- 凭据类 ----
  {
    label: "SECRET",
    pattern: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g,
    description: "sk- 前缀 API key（OpenAI/DeepSeek 等）",
  },
  {
    label: "SECRET",
    pattern: /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/g,
    description: "GitHub token",
  },
  {
    label: "SECRET",
    pattern: /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g,
    description: "AWS access key id",
  },
  {
    label: "SECRET",
    pattern: /AIza[0-9A-Za-z_-]{30,}/g,
    description: "Google API key",
  },
  {
    label: "SECRET",
    pattern: /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/g,
    description: "Slack token",
  },
  {
    label: "SECRET",
    pattern: /(?<![a-f0-9])[a-f0-9]{32}\.[a-f0-9]{16}(?![a-f0-9.])/g,
    description: "智谱 GLM API key（id.secret 两段式）",
  },
  {
    label: "SECRET",
    pattern:
      /(?<=(?:api[\s_-]?key|apikey|access[\s_-]?token|auth[\s_-]?token|secret[\s_-]?key|password|passwd|pwd)\s*[:=]\s*["']?)[A-Za-z0-9_\-./+]{16,}/gi,
    description: "上下文锚定的通用凭据（key/token/password = …）",
  },
  {
    label: "SECRET",
    pattern: /Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
    description: "Bearer token",
  },
  {
    label: "SECRET",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g,
    description: "JWT",
  },
  {
    label: "SECRET",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    description: "PEM 私钥块",
  },
  {
    label: "SECRET",
    pattern: /https?:\/\/[^/\s:@]+:[^/\s@]+@[^\s"'<>]+/g,
    description: "带账号密码的 URL",
  },

  // ---- 账号类 ----
  {
    label: "ACCOUNT",
    pattern: /(?<=微信号[:：\s]{0,4})[A-Za-z][A-Za-z0-9_-]{5,19}/g,
    description: "微信号（写在“微信号：”之后）",
  },
  {
    label: "ACCOUNT",
    pattern: /(?<=wxid_)[A-Za-z0-9_-]{6,}/g,
    description: "微信内部 id（wxid_ 前缀）",
  },
];
