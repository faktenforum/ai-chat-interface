export default defineAppConfig({
  ui: {
    colors: {
      primary: "indigo",
      secondary: "blue",
      tertiary: "teal",
      neutral: "zinc",
      success: "green",
      info: "orange",
      warning: "yellow",
      error: "red",
    },
    button: {
      defaultVariants: {
        variant: "outline",
        color: "neutral",
        size: "sm",
      },
      variants: {
        variant: {
          ghost: "focus:inset-ring-2 focus:inset-ring-primary",
          outline: "focus:inset-ring-2 focus:inset-ring-primary",
          subtle: "focus:inset-ring-2 focus:inset-ring-primary backdrop-blur-sm",
          soft: "focus:inset-ring-2 focus:inset-ring-primary",
        },
      },
      compoundVariants: [
        {
          variant: "outline",
          color: "neutral",
          class: "bg-transparent",
        },
      ],
    },
    badge: {
      defaultVariants: {
        variant: "subtle",
        color: "neutral",
        size: "sm",
      },
    },
    select: {
      defaultVariants: {
        variant: "subtle",
        size: "sm",
      },
    },
  },
});
