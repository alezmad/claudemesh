"use client";
import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

const fade: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.7,
      ease: [0.22, 0.61, 0.36, 1],
      delay: i * 0.08,
    },
  }),
};

export const Reveal = ({
  children,
  delay = 0,
  as: Tag = "div",
  className,
}: {
  children: ReactNode;
  delay?: number;
  as?: keyof typeof motion;
  className?: string;
}) => {
  const M = motion[Tag] as typeof motion.div;
  return (
    <M
      className={className}
      variants={fade}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      custom={delay}
    >
      {children}
    </M>
  );
};

export const RevealStagger = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <motion.div
    className={className}
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true, margin: "-80px" }}
    variants={{
      hidden: {},
      visible: { transition: { staggerChildren: 0.1 } },
    }}
  >
    {children}
  </motion.div>
);

export const StaggerItem = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <motion.div className={className} variants={fade}>
    {children}
  </motion.div>
);

const leafPath =
  "M12 2c-2 4-5 6-5 10a5 5 0 0010 0c0-4-3-6-5-10z";

export const SectionIcon = ({
  glyph = "leaf",
}: {
  glyph?: "leaf" | "arrow" | "grid" | "phone" | "terminal" | "mesh";
}) => {
  const paths: Record<string, string> = {
    leaf: leafPath,
    arrow: "M5 12h14m-6-6l6 6-6 6",
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    phone: "M7 3h10a1 1 0 011 1v16a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zm5 15v.01",
    terminal: "M4 6l4 4-4 4M12 16h8",
    mesh: "M12 3l9 5-9 5-9-5 9-5zm-9 12l9 5 9-5M3 10l9 5 9-5",
  };
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--cm-clay)]"
    >
      <path d={paths[glyph]} />
    </svg>
  );
};
