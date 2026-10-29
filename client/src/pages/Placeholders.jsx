import React from 'react';
import { Link } from 'react-router-dom';
import { Award } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

// What /badges shows until the teammate's badges page replaces it (it is theirs: leave it as is).
// The manage and admin placeholders are gone: every route under /manage and /admin has its page,
// and an unknown path there redirects to the section's first page (app/router.jsx).

export function BadgesPlaceholder() {
  return (
    <div className="space-y-6 font-mono">
      <div className="border-b-2 border-[#1a1a1a] pb-4 flex items-center justify-between">
        <div>
          <span className="text-xs uppercase font-bold text-[#e67e22] tracking-widest">
            SAFETY & TRAINING CREDENTIALS
          </span>
          <h1 className="text-2xl font-black text-[#1a1a1a]">Badges & Certifications</h1>
        </div>
        <Badge variant="amber" size="md">
          PHASE 3 TARGET
        </Badge>
      </div>

      <Card className="p-8 text-center max-w-xl mx-auto space-y-4">
        <div className="w-14 h-14 rounded-xl border-2 border-[#1a1a1a] bg-[#e67e22]/15 text-[#e67e22] flex items-center justify-center mx-auto shadow-[3px_3px_0_#1a1a1a]">
          <Award className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-black text-[#1a1a1a]">Safety Badge Registry</h3>
        <p className="text-xs text-[#1a1a1a]/70 leading-relaxed">
          Request department badges (3D Printing Basics, Laser Safety, HPC Slurm, UTM) and submit workshop
          completion proof for manager sign-off in Phase 3.
        </p>
        <Link to="/explore">
          <Button variant="outline" size="md">
            Return to Explore
          </Button>
        </Link>
      </Card>
    </div>
  );
}
