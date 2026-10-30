import React from 'react';
import { motion } from 'framer-motion';

// Aceternity UI's Text Generate Effect (ui.aceternity.com), in JavaScript: the words come into focus
// one after another the first time the text is on screen. Screen readers get the sentence whole.

const container = { show: { transition: { staggerChildren: 0.03 } } };
const word = {
  hidden: { opacity: 0, filter: 'blur(6px)' },
  show: { opacity: 1, filter: 'blur(0px)', transition: { duration: 0.35 } },
};

export function TextGenerateEffect({ words, className, as: Tag = 'p' }) {
  return (
    <Tag className={className}>
      <span className="sr-only">{words}</span>
      <motion.span aria-hidden="true" initial="hidden" whileInView="show" viewport={{ once: true }} variants={container}>
        {words.split(' ').map((w, i) => (
          <motion.span key={`${w}-${i}`} className="inline-block" variants={word}>
            {w}&nbsp;
          </motion.span>
        ))}
      </motion.span>
    </Tag>
  );
}
