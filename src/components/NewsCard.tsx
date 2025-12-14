import { useState } from "react";
import { Copy, Check, ExternalLink, Clock, RotateCcw, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";

interface NewsCardProps {
  id: string;
  title: string | null;
  link: string;
  responseText: string | null;
  publishedAt: string | null;
  processedAt: string;
  webhookMode: 'production' | 'test';
  onRetrySuccess?: () => void;
}

export function NewsCard({ id, title, link, responseText, publishedAt, processedAt, webhookMode, onRetrySuccess }: NewsCardProps) {
  const [copied, setCopied] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  
  const hasError = responseText?.startsWith('Webhook error:');

  // Use published date if available, otherwise fall back to processed date
  const displayDate = publishedAt || processedAt;

  const handleCopy = async () => {
    const textToCopy = responseText 
      ? `${responseText}\n\n${link}`
      : link;

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      toast.success("In Zwischenablage kopiert!");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Kopieren fehlgeschlagen");
    }
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      const { data, error } = await supabase.functions.invoke("check-rss", {
        body: { 
          webhookMode, 
          retryItem: { id, link, title } 
        }
      });
      
      if (error) {
        toast.error("Retry fehlgeschlagen");
        console.error(error);
      } else if (data.success) {
        toast.success("Webhook erfolgreich wiederholt");
        onRetrySuccess?.();
      } else {
        toast.error("Webhook erneut fehlgeschlagen");
        onRetrySuccess?.();
      }
    } catch (err) {
      toast.error("Verbindungsfehler");
      console.error(err);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Card className="group transition-all duration-300 hover:shadow-lg animate-slide-up">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground leading-tight line-clamp-2">
              {title || "Kein Titel"}
            </h3>
            <div className="flex items-center gap-2 mt-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {format(new Date(displayDate), "dd. MMM yyyy, HH:mm", { locale: de })}
              </span>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => window.open(link, "_blank")}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {responseText && (
          <div className={`rounded-lg p-4 mb-4 ${hasError ? 'bg-destructive/10 border border-destructive/20' : 'bg-muted'}`}>
            {hasError && (
              <div className="flex items-center gap-2 mb-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs font-medium">Webhook Fehler</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <p className={`text-sm whitespace-pre-wrap font-mono leading-relaxed flex-1 ${hasError ? 'text-destructive' : 'text-foreground'}`}>
                {responseText}
              </p>
              {hasError && (
                <Button
                  onClick={handleRetry}
                  size="sm"
                  variant="outline"
                  disabled={isRetrying}
                  className="shrink-0"
                >
                  {isRetrying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Retry
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-secondary px-3 py-2 rounded-md truncate text-muted-foreground">
            {link}
          </code>
          <Button
            onClick={handleCopy}
            size="lg"
            className="shrink-0 min-w-[140px] transition-all duration-200"
            variant={copied ? "outline" : "default"}
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Kopiert!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Kopieren
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
