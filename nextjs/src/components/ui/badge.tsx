import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        verified: "border-green-200 bg-green-50 text-green-700",
        invalid: "border-red-200 bg-red-50 text-red-700",
        noemail: "border-orange-200 bg-orange-50 text-orange-700",
        source: "border-green-200 bg-green-50 text-green-800 font-bold uppercase tracking-wide",
        country: "border-slate-200 bg-slate-100 text-slate-500",
        multi: "border-yellow-300 bg-yellow-50 text-yellow-800 uppercase tracking-wide",
        score_hot: "border-orange-400 text-orange-500 font-extrabold",
        score_warm: "border-blue-400 text-blue-500 font-bold",
        score_cold: "border-slate-300 text-slate-400 font-bold",
        primary_contact: "border-blue-200 bg-blue-50 text-blue-700 uppercase tracking-wide",
        secondary_contact: "border-slate-200 bg-slate-100 text-slate-500 uppercase tracking-wide",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
