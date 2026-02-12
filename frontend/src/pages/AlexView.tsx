import { useEffect, useState } from 'react';
import { 
  Brain, 
  Plus, 
  Edit2, 
  Trash2, 
  Star,
  Filter,
  Search,
  LayoutGrid,
  List
} from 'lucide-react';
import { 
  useSkills, 
  useCreateSkill, 
  useUpdateSkill, 
  useDeleteSkill,
  Skill 
} from '@/hooks/useApi';
import { SkeletonLoading } from '@/components/Loading';
import { realtimeService } from '@/services/realtime';
import { queryClient, queryKeys } from '@/utils/queryClient';

/**
 * AlexView Component
 * Knowledge/Skills management interface with React Query
 * Refactored to use React Query for global state management
 */
export default function AlexView() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isCreating, setIsCreating] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  // React Query hooks for data fetching
  const { 
    data: skills = [], 
    isLoading, 
    isError, 
    error,
    refetch 
  } = useSkills();

  // Mutations
  const createSkillMutation = useCreateSkill({
    onSuccess: () => {
      setIsCreating(false);
      setEditingSkill(null);
    }
  });

  const updateSkillMutation = useUpdateSkill({
    onSuccess: () => {
      setEditingSkill(null);
    }
  });

  const deleteSkillMutation = useDeleteSkill();

  // Subscribe to realtime updates
  useEffect(() => {
    const unsubscribe = realtimeService.subscribeToSkills((payload) => {
      console.log('Realtime skill update:', payload);
      
      // Invalidate skills query to refetch latest data
      queryClient.invalidateQueries({ queryKey: queryKeys.skills.lists() });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Filter skills based on search and category
  const filteredSkills = skills.filter(skill => {
    const matchesSearch = skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         skill.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || skill.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Get unique categories
  const categories = ['all', ...new Set(skills.map(skill => skill.category))];

  // Handle skill creation/update
  const handleSaveSkill = (skillData: {
    name: string;
    description: string;
    category: string;
    level: number;
  }) => {
    if (editingSkill) {
      updateSkillMutation.mutate({ id: editingSkill.id, data: skillData });
    } else {
      createSkillMutation.mutate(skillData);
    }
  };

  // Handle skill deletion
  const handleDeleteSkill = (skillId: string) => {
    if (window.confirm('Are you sure you want to delete this skill?')) {
      deleteSkillMutation.mutate(skillId);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <SkeletonLoading count={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-600 mb-4">
            Error loading skills: {error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Brain className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Alex Knowledge Base</h1>
        </div>
        <p className="text-gray-600">
          Manage AI skills, capabilities, and knowledge domains
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-gray-400" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {categories.map(category => (
              <option key={category} value={category}>
                {category === 'all' ? 'All Categories' : category}
              </option>
            ))}
          </select>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded ${viewMode === 'grid' ? 'bg-white shadow' : 'text-gray-500'}`}
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded ${viewMode === 'list' ? 'bg-white shadow' : 'text-gray-500'}`}
          >
            <List className="w-5 h-5" />
          </button>
        </div>

        {/* Add Skill Button */}
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Add Skill
        </button>
      </div>

      {/* Skills Count */}
      <div className="mb-4 text-sm text-gray-500">
        Showing {filteredSkills.length} of {skills.length} skills
      </div>

      {/* Skills Grid/List */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSkills.map(skill => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onEdit={() => setEditingSkill(skill)}
              onDelete={() => handleDeleteSkill(skill.id)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSkills.map(skill => (
            <SkillRow
              key={skill.id}
              skill={skill}
              onEdit={() => setEditingSkill(skill)}
              onDelete={() => handleDeleteSkill(skill.id)}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {(isCreating || editingSkill) && (
        <SkillModal
          skill={editingSkill}
          onClose={() => {
            setIsCreating(false);
            setEditingSkill(null);
          }}
          onSave={handleSaveSkill}
          isLoading={createSkillMutation.isPending || updateSkillMutation.isPending}
        />
      )}

      {/* Empty State */}
      {filteredSkills.length === 0 && !isLoading && (
        <div className="text-center py-16">
          <Brain className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No skills found</h3>
          <p className="text-gray-500 mb-4">
            {searchQuery || selectedCategory !== 'all'
              ? 'Try adjusting your filters'
              : 'Get started by adding your first skill'}
          </p>
          {(searchQuery || selectedCategory !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
              }}
              className="text-blue-600 hover:text-blue-700"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Skill Card Component
function SkillCard({ skill, onEdit, onDelete }: { 
  skill: Skill; 
  onEdit: () => void; 
  onDelete: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
          {skill.category}
        </span>
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 text-gray-400 hover:text-red-600 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2">{skill.name}</h3>
      <p className="text-gray-600 text-sm mb-4 line-clamp-2">{skill.description}</p>

      <div className="flex items-center gap-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <Star
            key={i}
            className={`w-4 h-4 ${
              i < skill.level ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'
            }`}
          />
        ))}
        <span className="ml-2 text-sm text-gray-500">{skill.level}/10</span>
      </div>
    </div>
  );
}

// Skill Row Component
function SkillRow({ skill, onEdit, onDelete }: { 
  skill: Skill; 
  onEdit: () => void; 
  onDelete: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between hover:shadow-md transition-shadow">
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-1">
          <h3 className="font-semibold text-gray-900">{skill.name}</h3>
          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
            {skill.category}
          </span>
        </div>
        <p className="text-gray-600 text-sm">{skill.description}</p>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-1">
          {Array.from({ length: skill.level }).map((_, i) => (
            <Star key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 text-gray-400 hover:text-red-600 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Skill Modal Component
function SkillModal({ 
  skill, 
  onClose, 
  onSave, 
  isLoading 
}: { 
  skill: Skill | null; 
  onClose: () => void; 
  onSave: (data: {
    name: string;
    description: string;
    category: string;
    level: number;
  }) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    name: skill?.name || '',
    description: skill?.description || '',
    category: skill?.category || '',
    level: skill?.level || 5
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          {skill ? 'Edit Skill' : 'Add New Skill'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              required
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <input
              type="text"
              required
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Level ({formData.level}/10)
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={formData.level}
              onChange={(e) => setFormData({ ...formData, level: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : skill ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
