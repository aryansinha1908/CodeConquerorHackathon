import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export function RequireRole({ roles = [], children }) {
  const { user } = useAuthStore();
  
  const userRoles = Array.isArray(user?.roles) 
    ? user.roles 
    : user?.role 
      ? [user.role] 
      : [];

  const hasRole = roles.some((r) => userRoles.includes(r));

  if (!hasRole) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6 font-mono">
        <div className="bg-white border-2 border-[#1a1a1a] rounded-xl p-8 max-w-md w-full shadow-[6px_6px_0_#1a1a1a] text-center">
          <div className="w-14 h-14 bg-[#c0392b]/10 border-2 border-[#1a1a1a] rounded-xl flex items-center justify-center mx-auto mb-4 text-[#c0392b]">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-black text-[#1a1a1a] tracking-tight">403 // ACCESS DENIED</h2>
          <p className="text-sm text-[#1a1a1a]/70 my-3 leading-relaxed">
            This module requires <span className="font-bold text-[#c0392b]">{roles.join(' or ')}</span> authorization.
            Your account ({user?.email || 'Guest'}) does not have permission.
          </p>
          <div className="pt-2 flex justify-center">
            <Link to="/explore">
              <Button variant="outline" size="md">
                <ArrowLeft className="w-4 h-4" />
                Return to Explore
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return children;
}

