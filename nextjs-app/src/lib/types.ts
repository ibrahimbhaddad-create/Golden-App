export type Role = "admin" | "viewer";
export type UserStatus = "pending" | "active" | "suspended";
export type Karat = 24 | 22 | 21 | 18;

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  status: UserStatus;
  telegram_chat_id: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface KaratConfig {
  making: number; // SAR per gram
  margin_pct: number; // % on top of (ask + making)
}

export interface Settings {
  usd_sar: number;
  karats: Record<string, KaratConfig>;
  fallback_spread_usd: number;
  ai_summary_enabled: boolean;
  updated_at?: string;
}

export interface PriceTick {
  id?: number;
  time: string;
  spot: number;
  bid: number | null;
  ask: number | null;
  source: string;
}

export interface Candle {
  bucket: string;
  open: number;
  high: number;
  low: number;
  close: number;
  n?: number;
}

export type AlertType = "ounce_price" | "gram_price" | "pct_change";
export type AlertDirection = "above" | "below";
export type PriceSide = "bid" | "ask" | "spot";
export type ChangeWindow = "1h" | "24h" | "day_open";

export interface Alert {
  id: string;
  user_id: string;
  type: AlertType;
  direction: AlertDirection;
  threshold: number;
  karat: Karat | null;
  price_side: PriceSide;
  change_window: ChangeWindow | null;
  mode: "once" | "recurring";
  cooldown_minutes: number;
  channels: ("push" | "telegram")[];
  active: boolean;
  note: string | null;
  last_triggered_at: string | null;
  trigger_count: number;
  created_at: string;
}

export interface AlertEvent {
  id: number;
  alert_id: string | null;
  user_id: string;
  fired_at: string;
  title: string;
  body: string;
  observed_value: number | null;
  delivery: Record<string, unknown>;
}
