import { cn } from "@/lib/utils"

interface AppIconProps {
  size?: number
  className?: string
}

/** آیکون رسمی Atlas — از public/atlas-icon.png
 * مسیر نسبی (BASE_URL) چون اپ پکیج‌شده با پروتکل file:// اجرا میشود و
 * مسیر مطلق «/atlas-icon.png» آنجا به ریشهٔ فایل‌سیستم اشاره میکند و میشکند.
 */
export function AppIcon({ size = 20, className }: AppIconProps): React.JSX.Element {
  return (
    <img
      src={`${import.meta.env.BASE_URL}atlas-icon.png`}
      width={size}
      height={size}
      alt="Atlas"
      draggable={false}
      className={cn("rounded-md object-contain", className)}
    />
  )
}
