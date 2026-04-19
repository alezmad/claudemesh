"use client";

import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

const fade: Variants = {
  hidden: { opacity: 0, y: 20, filter: "blur(4px)" },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
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
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) => (
  <motion.div
    className={className}
    variants={fade}
    initial="hidden"
    animate="visible"
    custom={delay}
  >
    {children}
  </motion.div>
);
