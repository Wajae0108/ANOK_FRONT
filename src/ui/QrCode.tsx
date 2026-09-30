import { useEffect, useState } from "react";
import QRCode from "qrcode";

// MFA 등록용 otpauth:// URI를 브라우저에서 QR 이미지로 그린다(서버/외부 서비스로 URI를 보내지 않는다).
export default function QrCode({ value, size = 176 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null); setFailed(false);
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then(url => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [value, size]);

  if (failed) return <p className="text-[11px] text-rose-500">QR 코드를 만들지 못했습니다. 아래 수동 입력 키를 사용해 주세요.</p>;
  return (
    <div className="flex justify-center">
      <div className="bg-white border border-slate-200 rounded-xl p-2" style={{ width: size + 18, height: size + 18 }}>
        {src && <img src={src} width={size} height={size} alt="MFA 등록 QR 코드" />}
      </div>
    </div>
  );
}
