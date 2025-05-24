import winston from "winston";
import dotenv from "dotenv";
dotenv.config();

// 로그 레벨 타입 정의
type LogLevel =
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "verbose"
  | "section"
  | "step";

// 로그 레벨 정의
const levels: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 4,
  section: 5,
  step: 6,
};

// 로그 레벨별 색상 및 심볼 정의
const logConfig: Record<LogLevel, { color: string; symbol: string }> = {
  error: { color: "red", symbol: "✖" },
  warn: { color: "yellow", symbol: "⚠" },
  info: { color: "cyan", symbol: "ℹ" },
  debug: { color: "gray", symbol: "🔍" },
  verbose: { color: "white", symbol: "📝" },
  section: { color: "magenta", symbol: "===" },
  step: { color: "green", symbol: "→" },
};

// winston에 커스텀 레벨과 색상 추가
winston.addColors(
  Object.entries(logConfig).reduce(
    (acc, [level, config]) => {
      acc[level] = config.color;
      return acc;
    },
    {} as Record<string, string>,
  ),
);

// 안전한 심볼 가져오기 함수
const getLogSymbol = (level: string): string => {
  return logConfig[level as LogLevel]?.symbol || "•";
};

const isDebugMode =
  process.env.LOG_LEVEL === "debug" ||
  process.env.DEBUG === "1" ||
  process.env.DEBUG === "true";

const filterDebug = winston.format((info) => {
  if (info.level === "debug" && !isDebugMode) return false;
  return info;
});

// 로거 생성
const logger = winston.createLogger({
  levels,
  level: "step", // 가장 낮은 레벨로 설정하여 모든 로그를 허용
  format: winston.format.combine(
    filterDebug(),
    winston.format.timestamp({ format: "HH:mm:ss" }),
    winston.format.printf((info) => {
      const symbol = getLogSymbol(info.level);
      if (info.level === "section" || info.level === "step") {
        return `${symbol} ${info.message}`;
      }
      return `${symbol} ${info.timestamp} ${info.level}: ${info.message}`;
    }),
    winston.format.colorize({ all: true }),
  ),
  transports: [new winston.transports.Console()],
});

// 편의를 위한 래퍼 함수들
export const log = {
  error: (message: string, ...meta: any[]) => logger.error(message, ...meta),
  warn: (message: string, ...meta: any[]) => logger.warn(message, ...meta),
  info: (message: string, ...meta: any[]) => logger.info(message, ...meta),
  debug: (message: string, ...meta: any[]) => logger.debug(message, ...meta),
  verbose: (message: string, ...meta: any[]) =>
    logger.verbose(message, ...meta),
  section: (message: string, ..._meta: any[]) => logger.log("section", message),
  step: (message: string, ..._meta: any[]) => logger.log("step", message),
};

export default logger;
