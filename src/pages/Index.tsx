import { useState, useEffect } from "react";
import { RefreshCw, Rss, Loader2, Trash2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewsCard } from "@/components/NewsCard";
import { StatusIndicator } from "@/components/StatusIndicator";
import { useNewsItems } from "@/hooks/useNewsItems";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const RSS_SOURCES = {
  nius: { name: 'NIUS', url: 'nius.de/rss' },
  jungefreiheit: { name: 'Junge Freiheit', url: 'jungefreiheit.de/feed' },
  apollonews: { name: 'Apollo News', url: 'apollo-news.net/feed' },
  freilichmagazin: { name: 'Freilich Magazin', url: 'freilich-magazin.com/rss.xml' }
} as const;

type SourceKey = keyof typeof RSS_SOURCES;

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
  const [webhookMode, setWebhookMode] = useState<'production' | 'test'>('production');
  const [enabledSources, setEnabledSources] = useState<SourceKey[]>(['nius', 'jungefreiheit', 'apollonews', 'freilichmagazin']);
  const [isMonitoringOn, setIsMonitoringOn] = useState(true);
  const [teamsEnabled, setTeamsEnabled] = useState(false);
  const [teamsMode, setTeamsMode] = useState<'production' | 'test'>('production');

  useEffect(() => {
    const interval = setInterval(() => {
      setIsActive(isWithinOperatingHours());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleManualCheck = async () => {
    if (enabledSources.length === 0) {
      toast.error("Bitte mindestens eine Quelle aktivieren");
      return;
    }
    
    setIsChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("check-rss", {
        body: { webhookMode, sources: enabledSources, teamsEnabled, teamsMode }
      });
      
      if (error) {
        toast.error("Fehler beim Prüfen des RSS-Feeds");
        console.error(error);
      } else {
        const sourcesText = enabledSources.map(s => RSS_SOURCES[s].name).join(' + ');
        toast.success(`${data.processed} neue Artikel verarbeitet (${sourcesText}, ${webhookMode === 'test' ? 'Test' : 'Prod'})`);
        refetch();
      }
    } catch (err) {
      toast.error("Verbindungsfehler");
      console.error(err);
    } finally {
      setIsChecking(false);
    }
  };

  const toggleSource = (source: SourceKey) => {
    setEnabledSources(prev => 
      prev.includes(source) 
        ? prev.filter(s => s !== source)
        : [...prev, source]
    );
  };

  const handleCleanup = async () => {
    setIsCleaning(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-news", {
        body: { deleteAll: true }
      });
      
      if (error) {
        toast.error("Fehler beim Löschen");
        console.error(error);
      } else if (data?.success) {
        toast.success("Alle Artikel gelöscht");
        refetch();
      } else {
        toast.error("Fehler beim Löschen");
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
                <h1 className="text-xl font-bold text-foreground">News Monitor</h1>
                <p className="text-xs text-muted-foreground">
                  {enabledSources.map(s => RSS_SOURCES[s].name).join(' + ') || 'Keine Quellen'} → n8n
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Sources Settings */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon">
                    <Settings className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="end">
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-sm mb-2">RSS Quellen</h4>
                      <div className="space-y-2">
                        {(Object.keys(RSS_SOURCES) as SourceKey[]).map((key) => (
                          <div key={key} className="flex items-center gap-2">
                            <Checkbox
                              id={`source-${key}`}
                              checked={enabledSources.includes(key)}
                              onCheckedChange={() => toggleSource(key)}
                            />
                            <Label htmlFor={`source-${key}`} className="text-sm cursor-pointer">
                              {RSS_SOURCES[key].name}
                              <span className="block text-xs text-muted-foreground">
                                {RSS_SOURCES[key].url}
                              </span>
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="border-t pt-3">
                      <h4 className="font-medium text-sm mb-2">Webhook</h4>
                      <div className="flex items-center gap-2">
                        <Switch
                          id="webhook-mode-popover"
                          checked={webhookMode === 'test'}
                          onCheckedChange={(checked) => setWebhookMode(checked ? 'test' : 'production')}
                        />
                        <Label htmlFor="webhook-mode-popover" className="text-sm cursor-pointer">
                          {webhookMode === 'test' ? (
                            <span className="text-yellow-600 dark:text-yellow-400">Test Mode</span>
                          ) : (
                            <span className="text-green-600 dark:text-green-400">Production</span>
                          )}
                        </Label>
                      </div>
                    </div>
                    <div className="border-t pt-3">
                      <h4 className="font-medium text-sm mb-2">Microsoft Teams</h4>
                      <div className="flex items-center gap-2 mb-2">
                        <Switch
                          id="teams-enabled"
                          checked={teamsEnabled}
                          onCheckedChange={setTeamsEnabled}
                        />
                        <Label htmlFor="teams-enabled" className="text-sm cursor-pointer">
                          {teamsEnabled ? (
                            <span className="text-green-600 dark:text-green-400">Aktiviert (ON)</span>
                          ) : (
                            <span className="text-muted-foreground">Deaktiviert (OFF)</span>
                          )}
                        </Label>
                      </div>
                      {teamsEnabled && (
                        <div className="flex items-center gap-2 ml-6">
                          <Switch
                            id="teams-mode"
                            checked={teamsMode === 'test'}
                            onCheckedChange={(checked) => setTeamsMode(checked ? 'test' : 'production')}
                          />
                          <Label htmlFor="teams-mode" className="text-sm cursor-pointer">
                            {teamsMode === 'test' ? (
                              <span className="text-yellow-600 dark:text-yellow-400">Test</span>
                            ) : (
                              <span className="text-green-600 dark:text-green-400">Production</span>
                            )}
                          </Label>
                        </div>
                      )}
                    </div>
                    <div className="border-t pt-3">
                      <h4 className="font-medium text-sm mb-2">Monitoring</h4>
                      <div className="flex items-center gap-2">
                        <Switch
                          id="monitoring-switch"
                          checked={isMonitoringOn}
                          onCheckedChange={setIsMonitoringOn}
                        />
                        <Label htmlFor="monitoring-switch" className="text-sm cursor-pointer">
                          {isMonitoringOn ? (
                            <span className="text-green-600 dark:text-green-400">Aktiv (ON)</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400">Pausiert (OFF)</span>
                          )}
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {isMonitoringOn ? 'Läuft zwischen 7:00-20:00 Uhr' : 'Automatische Prüfung deaktiviert'}
                      </p>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <StatusIndicator isActive={isActive && isMonitoringOn} />
            </div>
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
                  publishedAt={item.published_at}
                  processedAt={item.processed_at}
                  webhookMode={webhookMode}
                  onRetrySuccess={refetch}
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
