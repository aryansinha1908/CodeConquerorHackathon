import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";

import { queryClient } from "./app/queryClient";
import { router } from "./app/router";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster
        position="top-right"
        toastOptions={{
          classNames: {
            toast:
              "font-mono border-2 border-[#1a1a1a] shadow-[3px_3px_0_#1a1a1a] rounded-lg",
            title: "font-bold text-[#1a1a1a]",
            description: "text-[#1a1a1a]/60",
            success: "bg-[#f0faf5] border-[#27ae60]",
            error: "bg-[#fff5f5] border-[#c0392b]",
            info: "bg-[#f0f4ff] border-[#2980b9]",
          },
        }}
      />
    </QueryClientProvider>
  );
}
