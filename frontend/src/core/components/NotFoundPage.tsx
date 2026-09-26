import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileQuestion, ArrowLeft, Home } from 'lucide-react';
import { Button } from '../../components/ui/button';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6 bg-[#1e1f24] border border-[#2a2b31] p-8 rounded-2xl shadow-xl">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
          <FileQuestion className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold tracking-wider text-indigo-400 uppercase">
            HTTP 404 Not Found
          </span>
          <h1 className="text-2xl font-bold text-white tracking-tight">Page Not Found</h1>
          <p className="text-xs text-[#9ca3af] leading-relaxed">
            The requested route or administrative document does not exist in this portal.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 border-[#2a2b31] text-[#f8fafc] hover:bg-[#2a2b31]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go Back</span>
          </Button>

          <Button
            type="button"
            onClick={() => navigate('/overview')}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
          >
            <Home className="w-4 h-4" />
            <span>Overview</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFoundPage;
