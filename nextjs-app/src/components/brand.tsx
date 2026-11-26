export function Brand({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/icons/icon-192.png" alt="" width={size === "lg" ? 56 : 32} height={size === "lg" ? 56 : 32} className="rounded-xl" />
      <span className={`font-bold gold-text ${size === "lg" ? "text-3xl" : "text-lg"}`}>ذهب لايف</span>
    </div>
  );
}
