import { createContext, useContext } from 'react';

// The home page's "Pause animations" switch (WCAG 2.2.2: anything that moves for more than five
// seconds can be stopped). HomePage holds the state; the sections read it and hand `paused` to the
// components that loop: marquees, the rotating word, the moving border, the shimmer, the live list.

export const MotionPauseContext = createContext({ paused: false, setPaused: () => {} });

export const useMotionPause = () => useContext(MotionPauseContext);
