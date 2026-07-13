import { AlertCircle, ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../../remote/store";

export function ReviewPanel() {
  const review = useAppStore((s) => s.review);
  const reviewLoaded = useAppStore((s) => s.reviewLoaded);
  const [slow, setSlow] = useState(false);
  const [readyToLoad, setReadyToLoad] = useState(false);
  useEffect(() => {
    setSlow(false);
    setReadyToLoad(false);
    const loadTimer = setTimeout(() => setReadyToLoad(true), 650);
    const slowTimer = setTimeout(() => setSlow(true), 8_000);
    return () => { clearTimeout(loadTimer); clearTimeout(slowTimer); };
  }, [review?.reviewId]);
  if (!review) return null;
  return <div className="review-panel">
    {review.loading && <div className="review-loading"><LoaderCircle className="spin" /><strong>Opening {review.kind} review…</strong><span>Waiting for Plannotator on the remote host.</span>{slow && <p><AlertCircle size={16} /> This is taking longer than expected. Check `PLANNOTATOR_PORT` and the remote firewall.</p>}</div>}
    {readyToLoad && <iframe title={`Plannotator ${review.kind} review`} src={review.url} onLoad={reviewLoaded} />}
    <a className="review-external" href={review.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open externally</a>
  </div>;
}
