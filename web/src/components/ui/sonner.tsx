import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useUi } from "@/store/ui"

// The app theme lives in the zustand ui store (a `.dark` class on <html>), not next-themes, so read it from there.
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useUi((s) => s.theme)
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      // bottom-18 (72px) clears the canvas's floating toolbar (bottom-4, 40px tall).
      offset={{ bottom: 72 }}
      mobileOffset={{ bottom: 72 }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "14px",
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: "cn-toast shadow-overlay! text-xs!" } }}
      {...props}
    />
  )
}

export { Toaster }
