import { useEffect, useState } from "react";

export type SectionId = "overview" | "bills" | "budget" | "settings";

const SECTIONS: SectionId[] = ["overview", "bills", "budget", "settings"];

/** 侧栏与底部导航共用同一个「当前区块」，滚动时高亮真实可见的那一节。 */
export function useActiveSection(): [SectionId, (id: SectionId) => void] {
  const [active, setActive] = useState<SectionId>("overview");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id as SectionId);
      },
      { rootMargin: "-72px 0px -55% 0px", threshold: [0.15, 0.4, 0.75] },
    );
    for (const id of SECTIONS) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return [active, setActive];
}
