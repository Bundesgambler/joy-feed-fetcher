import { useState, useEffect } from "react";
import { RefreshCw, Rss, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewsCard } from "@/components/NewsCard";
import { StatusIndicator } from "@/components/StatusIndicator";
import { useNewsItems } from "@/hooks/useNewsItems";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function isWithinOperatingHours(): boolean {
  const now = new Date();
  const hour = now.getHours();
  return hour >= 7 && hour < 20;
}

const Index = () => {
  const { data: newsItems, isLoading, refetch } = useNewsItems();
  const [isChecking, setIsChecking] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isActive, setIsActive] = useState(isWithinOperatingHours());

  useEffect(() => {
    const interval = setInterval(() => {
      setIsActive(isWithinOperatingHours());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleManualCheck = async () => {
    setIsChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("check-rss");
      
      if (error) {
        toast.error("Fehler beim Prüfen des RSS-Feeds");
        console.error(error);
      } else {
        toast.success(`${data.processed} neue Artikel verarbeitet`);
        refetch();
      }
    } catch (err) {
      toast.error("Verbindungsfehler");
      console.error(err);
    } finally {
      setIsChecking(false);
    }
  };

  const handleCleanup = async () => {
    setIsCleaning(true);
    try {
      const { error } = await supabase
        .from("news_items")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all rows
      
      if (error) {
        toast.error("Fehler beim Löschen");
        console.error(error);
      } else {
        toast.success("Alle Artikel gelöscht");
        refetch();
      }
    } catch (err) {
      toast.error("Verbindungsfehler");
      console.error(err);
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
                <Rss className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">NIUS Monitor</h1>
                <p className="text-xs text-muted-foreground">nius.de/rss → n8n Webhook</p>
              </div>
            </div>
            <StatusIndicator isActive={isActive} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-4xl mx-auto px-4 py-8">
        {/* Controls */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Verarbeitete Artikel
            </h2>
            <p className="text-sm text-muted-foreground">
              {newsItems?.length || 0} Artikel insgesamt
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="lg"
                  disabled={isCleaning || !newsItems?.length}
                >
                  {isCleaning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Alle Artikel löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Dies löscht alle {newsItems?.length || 0} gespeicherten Artikel. 
                    Diese Aktion kann nicht rückgängig gemacht werden.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCleanup}>
                    Alle löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              onClick={handleManualCheck}
              disabled={isChecking}
              size="lg"
            >
              {isChecking ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Prüfe...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Jetzt prüfen
                </>
              )}
            </Button>
          </div>
        </div>

        {/* News List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : newsItems && newsItems.length > 0 ? (
          <div className="space-y-4">
            {newsItems.map((item, index) => (
              <div 
                key={item.id}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <NewsCard
                  id={item.id}
                  title={item.title}
                  link={item.link}
                  responseText={item.response_text}
                  processedAt={item.processed_at}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <Rss className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Noch keine Artikel
            </h3>
            <p className="text-muted-foreground mb-6">
              Klicke auf "Jetzt prüfen" um den RSS-Feed zu überprüfen
            </p>
            <Button onClick={handleManualCheck} disabled={isChecking}>
              {isChecking ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Prüfe...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  RSS-Feed prüfen
                </>
              )}
            </Button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-auto">
        <div className="container max-w-4xl mx-auto px-4 py-4">
          <p className="text-xs text-center text-muted-foreground">
            Automatische Prüfung alle 15 Minuten zwischen 7:00 und 20:00 Uhr
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
