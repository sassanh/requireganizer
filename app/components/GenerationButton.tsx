import { Button, ButtonProps } from "@mui/material";
import { useState } from "react";

interface GenerationButtonProps
  extends Omit<ButtonProps, "loading" | "onClick"> {
  onGenerate: () => unknown;
}

export default function GenerationButton({
  disabled,
  endIcon,
  onGenerate,
  startIcon,
  ...buttonProps
}: GenerationButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      await onGenerate();
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      {...buttonProps}
      disabled={disabled || isGenerating}
      endIcon={endIcon}
      loading={isGenerating}
      loadingPosition={startIcon ? "start" : endIcon ? "end" : "center"}
      onClick={handleGenerate}
      startIcon={startIcon}
    />
  );
}
