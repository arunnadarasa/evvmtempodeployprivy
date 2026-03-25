import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Web3Provider } from "@/components/Web3Provider";
import { Navbar } from "@/components/Navbar";
import Index from "./pages/Index";
import Deploy from "./pages/Deploy";
import Signatures from "./pages/Signatures";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";

const App = () => (
  <Web3Provider>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <div className="min-h-screen bg-background">
          <Navbar />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/deploy" element={<Deploy />} />
            <Route path="/signatures" element={<Signatures />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </BrowserRouter>
    </TooltipProvider>
  </Web3Provider>
);

export default App;
