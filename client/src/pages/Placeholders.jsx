import React from 'react';
import { Link } from 'react-router-dom';
import { Award, Layers, Shield } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

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

export function ManagePlaceholder() {
  return (
    <div className="space-y-6 font-mono">
      <Card className="p-8 text-center max-w-xl mx-auto space-y-4">
        <div className="w-14 h-14 rounded-xl border-2 border-[#1a1a1a] bg-[#e67e22]/15 text-[#e67e22] flex items-center justify-center mx-auto shadow-[3px_3px_0_#1a1a1a]">
          <Layers className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-black text-[#1a1a1a]">Facility Review & Handover Desk</h3>
        <p className="text-xs text-[#1a1a1a]/70 leading-relaxed">
          Manager review queue grouped by conflicting slots, condition photo comparisons, and incident reporting
          coming in Phases 2 and 3.
        </p>
      </Card>
    </div>
  );
}

export function AdminPlaceholder() {
  return (
    <div className="space-y-6 font-mono">
      <Card className="p-8 text-center max-w-xl mx-auto space-y-4">
        <div className="w-14 h-14 rounded-xl border-2 border-[#1a1a1a] bg-[#c0392b]/15 text-[#c0392b] flex items-center justify-center mx-auto shadow-[3px_3px_0_#1a1a1a]">
          <Shield className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-black text-[#1a1a1a]">Institute Administration Console</h3>
        <p className="text-xs text-[#1a1a1a]/70 leading-relaxed">
          ID card verification queue, user role management, cryptographic audit trail, and escalation handling
          coming in Phase 3.
        </p>
      </Card>
    </div>
  );
}

