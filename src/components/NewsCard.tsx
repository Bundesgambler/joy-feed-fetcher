import { useState } from "react";
import { Copy, Check, ExternalLink, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface NewsCardProps {
  id: string;
  title: string | null;
  link: string;
  responseText: string | null;
  publishedAt: string | null;
  processedAt: string;
}

export function NewsCard({ title, link, responseText, publishedAt, processedAt }: NewsCardProps) {
  const [copied, setCopied] = useState(false);

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
          <div className="bg-muted rounded-lg p-4 mb-4">
            <p className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
              {responseText}
            </p>
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
