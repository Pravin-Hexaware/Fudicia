import React, { useEffect, useState } from 'react';
import { FiFileText, FiLayers, FiDatabase, FiDownload } from 'react-icons/fi';
import TableMui from '../components/TableMui';
import Header from '../components/Header';
import toast from 'react-hot-toast';

const API_BASE_URL = 'http://localhost:8000';

interface DashboardStats {
  fund_mandates: number;
  extracted_parameters: number;
  companies: number;
  generated_documents: number;
  recent_mandates: MandateRow[];
}

interface MandateRow {
  id: number;
  legal_name: string;
  strategy_type: string;
  vintage_year: number;
  primary_analyst: string;
  created_at: string;
}

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardStats();
  }, []);

  const fetchDashboardStats = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/dashboard/stats`);
      if (!response.ok) {
        throw new Error('Failed to fetch dashboard stats');
      }
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      toast.error('Failed to load dashboard statistics');
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (dateString: string): string => {
  const now = new Date();
  const date = new Date(dateString);

  if (isNaN(date.getTime())) {
    return "Invalid date";
  }

  let diffInMs = now.getTime() - date.getTime();

  if (diffInMs < 0) diffInMs = 0;

  const seconds = Math.floor(diffInMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return "Just now";
  } else if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  } else if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  } else if (days < 7) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  } else {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
};

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="text-gray-600 mt-4">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      label: 'Fund Mandates',
      value: stats?.fund_mandates || 0,
      icon: FiFileText,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      label: 'Extracted Parameters',
      value: stats?.extracted_parameters || 0,
      icon: FiLayers,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
    },
    {
      label: 'Companies',
      value: stats?.companies || 0,
      icon: FiDatabase,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
    },
    {
      label: 'Generated Reports',
      value: stats?.generated_documents || 0,
      icon: FiDownload,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <Header title="Dashboard" subtitle="Overview of your fund mandate platform" />
      <div className="p-6">

        {/* Stats Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
          {statCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <div
                key={index}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      {card.label}
                    </p>
                    <p className="text-xl font-bold text-gray-900 mt-1">{card.value}</p>
                  </div>
                  <div className={`${card.bgColor} p-2 rounded-lg`}> 
                    <Icon className={`w-5 h-5 ${card.color}`} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Recently Created Mandates */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-3 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Mandates</h2>
          </div>

          <div className="p-6">
            {stats?.recent_mandates && stats.recent_mandates.length > 0 ? (
              <TableMui
                columns={[
                  { key: 'number', label: 'S.No.', width: '48px' },
                  { key: 'legal_name', label: 'Fund Name', minWidth: '200px' },
                  { key: 'strategy_type', label: 'Strategy', minWidth: '150px' },
                  { key: 'vintage_year', label: 'Vintage Year', minWidth: '100px', textAlign: 'center' },
                  { key: 'primary_analyst', label: 'Analyst', minWidth: '150px' },
                  { key: 'created_at', label: 'Created', minWidth: '120px', textAlign: 'center' },
                ]}
                rows={stats.recent_mandates.map((mandate, index) => ({
                  number: index + 1,
                  legal_name: mandate.legal_name,
                  strategy_type: mandate.strategy_type,
                  vintage_year: mandate.vintage_year,
                  primary_analyst: mandate.primary_analyst,
                  created_at: formatTimeAgo(mandate.created_at),
                }))}
                maxHeight="400px"
              />
            ) : (
              <div className="text-center py-12">
                <FiFileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No fund mandates created yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
