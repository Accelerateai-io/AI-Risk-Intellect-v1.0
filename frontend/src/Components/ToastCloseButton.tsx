import { X } from "lucide-react";
import type { CloseButtonProps } from "react-toastify";

export function ToastCloseButton({ closeToast }: CloseButtonProps) {
  return (
    <button
      type="button"
      className="Toastify__close-button Toastify__close-button--custom"
      onClick={closeToast}
      aria-label="Close notification"
    >
      <X size={15} strokeWidth={2.25} aria-hidden />
    </button>
  );
}
