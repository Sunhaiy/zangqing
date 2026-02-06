import { create } from 'zustand';
import { Language } from '../shared/locales';

interface SettingsState {
    language: Language;
    uiFontFamily: string;
    terminalFontFamily: string;
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    cursorStyle: 'block' | 'underline' | 'bar';
    cursorBlink: boolean;
    // Advanced Rendering
    rendererType: 'canvas' | 'webgl';
    scrollback: number;
    brightBold: boolean;
    // Sound
    bellStyle: 'none' | 'visual' | 'sound';

    setLanguage: (lang: Language) => void;
    setUiFontFamily: (font: string) => void;
    setTerminalFontFamily: (font: string) => void;
    setFontSize: (size: number) => void;
    setLineHeight: (height: number) => void;
    setLetterSpacing: (spacing: number) => void;
    setCursorStyle: (style: 'block' | 'underline' | 'bar') => void;
    setCursorBlink: (blink: boolean) => void;

    // Advanced Actions
    setRendererType: (type: 'canvas' | 'webgl') => void;
    setScrollback: (lines: number) => void;
    setBrightBold: (enabled: boolean) => void;
    setBellStyle: (style: 'none' | 'visual' | 'sound') => void;

    initSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    language: 'en',
    uiFontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    terminalFontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 14,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,

    // Defaults
    rendererType: 'canvas',
    scrollback: 5000,
    brightBold: true,
    bellStyle: 'none',

    setLanguage: (lang: Language) => {
        set({ language: lang });
        window.electron.storeSet('language', lang);
    },

    setUiFontFamily: (font: string) => {
        set({ uiFontFamily: font });
        window.electron.storeSet('uiFontFamily', font);
    },

    setTerminalFontFamily: (font: string) => {
        set({ terminalFontFamily: font });
        window.electron.storeSet('terminalFontFamily', font);
    },

    setFontSize: (size: number) => {
        set({ fontSize: size });
        window.electron.storeSet('fontSize', size);
    },

    setLineHeight: (height: number) => {
        set({ lineHeight: height });
        window.electron.storeSet('lineHeight', height);
    },

    setLetterSpacing: (spacing: number) => {
        set({ letterSpacing: spacing });
        window.electron.storeSet('letterSpacing', spacing);
    },

    setCursorStyle: (style: 'block' | 'underline' | 'bar') => {
        set({ cursorStyle: style });
        window.electron.storeSet('cursorStyle', style);
    },

    setCursorBlink: (blink: boolean) => {
        set({ cursorBlink: blink });
        window.electron.storeSet('cursorBlink', blink);
    },

    setRendererType: (type: 'canvas' | 'webgl') => {
        set({ rendererType: type });
        window.electron.storeSet('rendererType', type);
    },

    setScrollback: (lines: number) => {
        set({ scrollback: lines });
        window.electron.storeSet('scrollback', lines);
    },

    setBrightBold: (enabled: boolean) => {
        set({ brightBold: enabled });
        window.electron.storeSet('brightBold', enabled);
    },

    setBellStyle: (style: 'none' | 'visual' | 'sound') => {
        set({ bellStyle: style });
        window.electron.storeSet('bellStyle', style);
    },

    initSettings: async () => {
        const savedLang = await window.electron.storeGet('language');
        const savedUiFont = await window.electron.storeGet('uiFontFamily');
        const savedTerminalFont = await window.electron.storeGet('terminalFontFamily');
        // Fallback for migration: check old 'fontFamily' key if new key missing (optional, but good practice)
        const oldFontFamily = await window.electron.storeGet('fontFamily');

        const savedFontSize = await window.electron.storeGet('fontSize');
        const savedLineHeight = await window.electron.storeGet('lineHeight');
        const savedLetterSpacing = await window.electron.storeGet('letterSpacing');
        const savedCursorStyle = await window.electron.storeGet('cursorStyle');
        const savedCursorBlink = await window.electron.storeGet('cursorBlink');

        const savedRendererType = await window.electron.storeGet('rendererType');
        const savedScrollback = await window.electron.storeGet('scrollback');
        const savedBrightBold = await window.electron.storeGet('brightBold');
        const savedBellStyle = await window.electron.storeGet('bellStyle');

        set({
            language: (savedLang as Language) || 'en',
            uiFontFamily: (savedUiFont as string) || "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
            terminalFontFamily: (savedTerminalFont as string) || (oldFontFamily as string) || "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: (savedFontSize as number) || 14,
            lineHeight: (savedLineHeight as number) || 1.2,
            letterSpacing: (savedLetterSpacing as number) || 0,
            cursorStyle: (savedCursorStyle as 'block' | 'underline' | 'bar') || 'block',
            cursorBlink: typeof savedCursorBlink === 'boolean' ? savedCursorBlink : true,

            rendererType: (savedRendererType as 'canvas' | 'webgl') || 'canvas',
            scrollback: (savedScrollback as number) || 5000,
            brightBold: typeof savedBrightBold === 'boolean' ? savedBrightBold : true,
            bellStyle: (savedBellStyle as 'none' | 'visual' | 'sound') || 'none',
        });
    }
}));
