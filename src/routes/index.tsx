import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import bodyHtml from "../wiki/body.html?raw";
import "../wiki/smite.css";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [{ title: "Smite VB" }],
    links: [
      {
        rel: "preload",
        href: "/fonts/PenumbraFlareStd-Semibold.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
});

type WikiWindow = Window & {
  bootSmiteWiki?: () => void;
  __smiteWikiLoaded?: boolean;
  __smiteWikiLoading?: boolean;
};

function Home() {
  useEffect(() => {
    const w = window as WikiWindow;
    let cancelled = false;
    let script: HTMLScriptElement | null = null;

    const onError = (event: ErrorEvent) => {
      console.error(
        "[SMITE Wiki] Erro JavaScript:",
        event.message,
        event.filename,
        event.lineno
      );
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      console.error("[SMITE Wiki] Promise rejeitada:", event.reason);
    };

    const boot = () => {
      if (cancelled) return;
      if (typeof w.bootSmiteWiki !== "function") {
        console.error("[SMITE Wiki] bootSmiteWiki não está disponível.");
        return;
      }
      w.bootSmiteWiki();
    };

    const onReady = () => boot();

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    if (w.__smiteWikiLoaded) {
      boot();
    } else if (w.__smiteWikiLoading) {
      window.addEventListener("smite-wiki-ready", onReady);
    } else {
      w.__smiteWikiLoading = true;
      script = document.createElement("script");
      script.src = "/smite/wiki.js?v=5";
      script.async = false;

      script.onload = () => {
        w.__smiteWikiLoaded = true;
        w.__smiteWikiLoading = false;
        window.dispatchEvent(new Event("smite-wiki-ready"));
        boot();
      };

      script.onerror = () => {
        w.__smiteWikiLoading = false;
        console.error("[SMITE Wiki] Falha ao carregar:", script?.src);
      };

      document.body.appendChild(script);
    }

    return () => {
      cancelled = true;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("smite-wiki-ready", onReady);
    };
  }, []);

  return (
    <div
      id="smite-app"
      className="smite-app on-screen-main"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: bodyHtml }}
    />
  );
}
