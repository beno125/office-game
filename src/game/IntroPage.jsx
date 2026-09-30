export const introPageStyle = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "center",
  backgroundColor: "#1a1a1a",
  backgroundImage:
    'linear-gradient(90deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.07) 42%, transparent 68%), url("/intro-background.png")',
  backgroundSize: "cover",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  color: "#e8e8e8",
  font: "15px/1.5 system-ui, sans-serif",
  textAlign: "left",
  padding: "clamp(1.5rem, 7vw, 6rem)",
  boxSizing: "border-box",
};

export const introMenuStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "1.4rem",
  width: "min(28rem, 100%)",
  height: "25rem",
  maxHeight: "calc(100vh - 3rem)",
  boxSizing: "border-box",
  padding: "clamp(1.5rem, 3vw, 2.5rem)",
  background: "rgba(226, 0, 78, 0.46)",
  border: "4px solid #080808",
  borderRadius: "20px",
  boxShadow:
    "10px 12px 0 #080808, 0 24px 60px rgba(4, 7, 20, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.28)",
  backdropFilter: "blur(12px) saturate(145%)",
  WebkitBackdropFilter: "blur(12px) saturate(145%)",
};

export const introTitleStyle = {
  margin: 0,
  color: "#fff",
  fontFamily: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
  fontSize: "clamp(3.25rem, 7vw, 5.6rem)",
  fontWeight: 900,
  lineHeight: 0.82,
  letterSpacing: "0.01em",
  textTransform: "uppercase",
  WebkitTextStroke: "3px #080808",
  paintOrder: "stroke fill",
  textShadow: "5px 6px 0 #080808",
};

const subtitleStyle = {
  margin: 0,
  maxWidth: "22rem",
  padding: "0.6rem 0.8rem",
  color: "#fff",
  background: "rgba(8, 8, 8, 0.78)",
  borderRadius: "8px",
  fontSize: "13px",
  fontWeight: 800,
  lineHeight: 1.4,
  letterSpacing: "0.055em",
  textTransform: "uppercase",
};

const buttonStyle = {
  marginTop: "0.5rem",
  padding: "0.75rem 1.8rem",
  color: "#fff",
  background: "#f00458",
  border: "4px solid #080808",
  borderRadius: "12px",
  fontFamily: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
  fontSize: "clamp(1.35rem, 3vw, 1.75rem)",
  fontWeight: 900,
  lineHeight: 1,
  letterSpacing: "0.045em",
  textTransform: "uppercase",
  WebkitTextStroke: "1px #080808",
  paintOrder: "stroke fill",
  cursor: "pointer",
  boxShadow: "6px 7px 0 #080808",
};

export default function IntroPage({ onStartPlay }) {
  return (
    <main style={introPageStyle}>
      <div style={introMenuStyle}>
        <h1 style={introTitleStyle}>
          <span style={{ display: "block" }}>Office</span>
          <span style={{ display: "block" }}>Game</span>
        </h1>
        <p style={subtitleStyle}>Drive around the desk, explore the office, and find your way to the next level.</p>
        <button
          type="button"
          className="intro-start-button"
          style={buttonStyle}
          onClick={() => onStartPlay?.()}
        >
          Go Drive
        </button>
      </div>
    </main>
  );
}
