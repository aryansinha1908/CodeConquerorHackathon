import React from 'react';
import { useAuthStore } from '../../stores/auth';
import { IdCard, ArrowRight } from 'lucide-react';
// Links styled as buttons: a <Button> inside a <Link> is two nested controls for a screen reader.
import { LinkButton } from '../manage/components/Bits';

// Not mounted on any route today (app/router.jsx): an unverified member may browse, and booking
// checks verification itself (the API's ACCOUNT_VERIFIED eligibility rule, shown in the resource
// page's checklist with a link to /verification). Kept for a page that should be verified-only.
export function RequireVerified({ children }) {
  const { user } = useAuthStore();
  
  // Managers and Admins are typically exempt or pre-verified
  const roles = Array.isArray(user?.roles) ? user.roles : user?.role ? [user.role] : [];
  const isPrivileged = roles.includes('manager') || roles.includes('admin');
  const isApproved = user?.verification?.status === 'approved' || isPrivileged;

  if (!isApproved) {
    const isPending = user?.verification?.status === 'pending';

    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6 font-mono">
        <div className="bg-white border-2 border-[#1a1a1a] rounded-xl p-8 max-w-lg w-full shadow-[6px_6px_0_#1a1a1a]">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-[#e67e22]/15 border-2 border-[#1a1a1a] rounded-xl text-[#e67e22]">
              <IdCard className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-[#1a1a1a]/60">Verification Gate</p>
              <h2 className="text-lg font-black text-[#1a1a1a]">
                {isPending ? 'ID Verification Under Review' : 'ID Card Verification Required'}
              </h2>
            </div>
          </div>
          <p className="text-sm text-[#1a1a1a]/80 mb-6 leading-relaxed">
            {isPending
              ? 'Your student or faculty ID card is currently being reviewed by an institute administrator. You can browse resources, but reservations will unlock as soon as your ID is approved.'
              : 'To reserve equipment and labs across campus, all members must upload their institute ID card for verification.'}
          </p>
          <div className="flex flex-wrap gap-3">
            <LinkButton to="/verification" variant="primary">
              {isPending ? 'Check Verification Status' : 'Verify ID Card Now'}
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </LinkButton>
            <LinkButton to="/explore" variant="outline">
              Browse Resources
            </LinkButton>
          </div>
        </div>
      </div>
    );
  }

  return children;
}

